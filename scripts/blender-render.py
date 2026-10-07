#!/usr/bin/env python3
"""M6-T4 — render the demo shot list with Blender's own engine (headless).

Companion to `src/demo/shots.ts` (the shot list) and `scripts/render-demo.mjs`
(the driver). This reads `dist/demo/manifest.json` — written by
`src/demo/render.test.ts` — and, for each shot:

  - imports the ship's M6-T1 glTF export with Blender's OWN glTF importer,
  - places a camera at the shot's pose (a first-person eye on a deck), and
  - renders a PNG with Cycles (CPU) to the output directory.

It also renders the coffee-run clip's frames, which `render-demo.mjs` then
stitches into a GIF with ffmpeg.

Coordinate frame: the glTF importer converts glTF/three Y-up to Blender Z-up, so
a ship point (x, y, z) — Y is the thrust axis, decks descend in Y — lands at
Blender (x, -z, y). The camera looks along its own -Z; the walker yaw (three.js
`rotation.y`, yaw 0 looks along -Z) becomes the Blender forward
(-sin yaw, cos yaw, 0).

Robust like `scripts/blender-validate.py`: a failure is reported AS DATA (the
`--report` JSON), never thrown; Blender's C-level stdout is flushed to /dev/null
around the import so a warning can't corrupt the report.
"""

import argparse
import ctypes
import json
import logging
import math
import os
import sys
import time

import bpy  # noqa: F401  (provided by the bpy module build)
import mathutils


def log(msg):
    print(msg, file=sys.stderr, flush=True)


class _DevNull:
    """Redirect fd 1 to /dev/null for the duration of an import."""

    def __enter__(self):
        self._saved = os.dup(1)
        self._devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(self._devnull, 1)
        return self

    def __exit__(self, *exc):
        sys.stdout.flush()
        ctypes.CDLL(None).fflush(None)
        os.dup2(self._saved, 1)
        os.close(self._saved)
        os.close(self._devnull)
        return False


def blender_pos(ship_xyz):
    """Ship world (x, y, z) -> Blender world (x, -z, y)."""
    x, y, z = ship_xyz
    return mathutils.Vector((x, -z, y))


def look_forward(yaw):
    """The walker's camera forward in ship space -> Blender space."""
    fx = -math.sin(yaw)
    fz = -math.cos(yaw)
    return mathutils.Vector((fx, -fz, 0.0))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    world = bpy.data.worlds.new("demo-world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    # A low, warm-neutral ambient fill so unlit walls read; the practical fill
    # lights below do the real work.
    bg.inputs[0].default_value = (0.10, 0.11, 0.13, 1.0)
    bg.inputs[1].default_value = 1.2
    return scene


def add_rig(scene, eye, yaw):
    """A camera at `eye` looking `yaw`, with a small practical fill that rides it."""
    cam_data = bpy.data.cameras.new("demo-cam")
    cam_data.lens = 24.0  # a wide, interior-friendly field of view
    cam = bpy.data.objects.new("demo-cam", cam_data)
    cam.location = blender_pos(eye)
    fwd = look_forward(yaw)
    cam.rotation_euler = fwd.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam

    # Two warm point lights parented to the camera: a near fill just ahead of the
    # eye (a lamp you carry) and a slightly wider one above, so the room reads
    # without flattening it. Energy is in Watts; small rooms sit close by.
    for name, offset, energy, size in (
        ("fill-near", (0.0, 0.0, -0.4), 120.0, 0.7),
        ("fill-high", (0.0, 0.0, 1.6), 260.0, 1.6),
    ):
        light = bpy.data.lights.new(name, "POINT")
        light.energy = energy
        light.color = (1.0, 0.93, 0.85)
        light.shadow_soft_size = size
        obj = bpy.data.objects.new(name, light)
        obj.location = offset
        obj.parent = cam
        scene.collection.objects.link(obj)
    return cam


def configure_render(scene, width, height, samples, view, exposure):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    try:
        scene.view_settings.view_transform = view
    except Exception:  # noqa: BLE001  (older/newer Blender may rename views)
        pass
    scene.view_settings.exposure = exposure


def import_ship(path):
    with _DevNull():
        bpy.ops.import_scene.gltf(filepath=path)


def render_to(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("outdir")
    parser.add_argument("--width", type=int, default=900)
    parser.add_argument("--height", type=int, default=540)
    parser.add_argument("--samples", type=int, default=32)
    parser.add_argument("--frame-width", type=int, default=560)
    parser.add_argument("--frame-height", type=int, default=315)
    parser.add_argument("--frame-samples", type=int, default=20)
    parser.add_argument("--view", default="AgX")
    parser.add_argument("--exposure", type=float, default=1.0)
    parser.add_argument("--only", default="", help="render only this shot id")
    args = parser.parse_args()

    logging.disable(logging.CRITICAL)
    with open(args.manifest) as handle:
        manifest = json.load(handle)
    files = {preset["id"]: preset["file"] for preset in manifest["presets"]}
    os.makedirs(args.outdir, exist_ok=True)
    frames_dir = os.path.join(args.outdir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    report = {"engine": bpy.app.version_string, "shots": [], "failed": []}
    for shot in manifest["shots"]:
        if args.only and shot["id"] != args.only:
            continue
        try:
            path = files.get(shot["presetId"])
            if not path or not os.path.exists(path):
                raise FileNotFoundError(f"no glTF for preset {shot['presetId']}")
            scene = reset_scene()
            import_ship(path)
            started = time.time()
            if shot["kind"] == "still":
                configure_render(scene, args.width, args.height, args.samples, args.view, args.exposure)
                add_rig(scene, shot["pose"]["eye"], shot["pose"]["yaw"])
                out = os.path.join(args.outdir, os.path.basename(shot["asset"]))
                render_to(scene, out)
                report["shots"].append(
                    {"id": shot["id"], "file": out, "seconds": round(time.time() - started, 1)}
                )
                log(f"still {shot['id']} -> {out} ({report['shots'][-1]['seconds']}s)")
            else:
                configure_render(
                    scene,
                    args.frame_width,
                    args.frame_height,
                    args.frame_samples,
                    args.view,
                    args.exposure,
                )
                frames = shot["frames"]
                add_rig(scene, frames[0]["eye"], frames[0]["yaw"])
                out_frames = []
                for index, frame in enumerate(frames):
                    cam = scene.camera
                    cam.location = blender_pos(frame["eye"])
                    cam.rotation_euler = look_forward(frame["yaw"]).to_track_quat(
                        "-Z", "Y"
                    ).to_euler()
                    out = os.path.join(frames_dir, f"{shot['id']}_{index:04d}.png")
                    render_to(scene, out)
                    out_frames.append(out)
                report["shots"].append(
                    {
                        "id": shot["id"],
                        "kind": "clip",
                        "asset": shot["asset"],
                        "frames": out_frames,
                        "fps": shot["fps"],
                        "seconds": round(time.time() - started, 1),
                    }
                )
                log(f"clip {shot['id']} -> {len(out_frames)} frames ({report['shots'][-1]['seconds']}s)")
        except Exception as error:  # noqa: BLE001  (report, never throw)
            report["failed"].append({"id": shot["id"], "error": repr(error)})
            log(f"FAILED {shot['id']}: {error!r}")

    with open(os.path.join(args.outdir, "render-report.json"), "w") as handle:
        json.dump(report, handle, indent=2)
    log(f"done: {len(report['shots'])} shot(s), {len(report['failed'])} failed")
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
