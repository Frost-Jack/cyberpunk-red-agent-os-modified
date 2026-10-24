/* Downloads the requested playlist and prepares browser-compatible local media.
 * node tools/import-toktik.mjs --ytdlp path/to/yt-dlp.exe [--cookies path/to/cookies.txt]
 * Only YouTube cookies are copied to a temporary directory, never bundled. */
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), options = {};
while (args.length) {
  const key = args.shift();
  if (!["--ytdlp", "--cookies"].includes(key) || !args.length) throw new Error("Use --ytdlp executable and optional --cookies file");
  options[key] = args.shift();
}
const exe = options["--ytdlp"] || "yt-dlp";
const assets = path.join(root, "assets/toktik");
const catalogFile = path.join(assets, "catalog.json");
const data = JSON.parse(await readFile(catalogFile, "utf8"));
const temp = await mkdtemp(path.join(tmpdir(), "agent-toktik-"));
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || "Command failed");
  return result.stdout;
};
const probe = file => JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]));
let complete = 0;
try {
  const auth = [];
  if (options["--cookies"]) {
    const cookieCopy = path.join(temp, "cookies.txt");
    const exported = await readFile(options["--cookies"], "utf8");
    const youtube = exported.split(/\r?\n/).filter(line => /^(?:#HttpOnly_)?\.?(?:[\w-]+\.)*youtube\.com\t/i.test(line));
    if (!youtube.length) throw new Error("No YouTube cookies in the Netscape cookies file");
    await writeFile(cookieCopy, "# Netscape HTTP Cookie File\n" + youtube.join("\n") + "\n", "utf8");
    auth.push("--cookies", cookieCopy);
  }
  await mkdir(path.join(assets, "clips"), { recursive: true });
  await mkdir(path.join(assets, "posters"), { recursive: true });
  for (const clip of data.clips) {
    if (!/^[\w-]{11}$/.test(clip.id)) throw new Error("Invalid playlist video id");
    const target = path.join(assets, "clips", `${clip.id}.mp4`);
    try {
      let valid = false;
      try { const info = probe(target); valid = info.streams.some(s => s.codec_name === "h264") && info.streams.some(s => s.codec_name === "aac"); } catch { /* not downloaded yet */ }
      if (!valid) {
        console.log(`Downloading ${clip.id}: ${clip.title}`);
        const raw = path.join(temp, `${clip.id}.mp4`);
        run(exe, ["--ignore-config", "--no-cache-dir", ...auth, "--js-runtimes", `node:${process.execPath}`, "--remote-components", "ejs:github", "--no-playlist", "--no-progress", "--socket-timeout", "20", "--retries", "1", "--fragment-retries", "1", "-f", "bv*[height<=720][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<=720][ext=mp4]/best[height<=720]", "--merge-output-format", "mp4", "-o", raw, clip.source]);
        run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1", "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", target]);
      }
      const info = probe(target), video = info.streams.find(s => s.codec_type === "video");
      if (!video || !info.streams.some(s => s.codec_type === "audio")) throw new Error("Downloaded video has no video/audio stream");
      const poster = path.join(assets, "posters", `${clip.id}.jpg`);
      run("ffmpeg", ["-v", "error", "-y", "-ss", "0.3", "-i", target, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", poster]);
      Object.assign(clip, { src: `clips/${clip.id}.mp4`, poster: `posters/${clip.id}.jpg`, duration: Number(info.format.duration), width: video.width, height: video.height, bytes: (await stat(target)).size });
      complete++;
      await writeFile(catalogFile, JSON.stringify(data, null, 2) + "\n", "utf8");
      console.log(`Ready ${complete}/${data.clips.length}`);
    } catch (error) { console.error(`${clip.id}: ${error.message}`); }
  }
  console.log(`TokTik: ${complete}/${data.clips.length} local videos ready`);
  if (complete !== data.clips.length) process.exitCode = 1;
} finally { await rm(temp, { recursive: true, force: true }); }
