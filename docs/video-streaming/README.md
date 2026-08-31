# Video streaming

C4 Raven ingests live video through [MediaMTX](https://github.com/bluenviron/mediamtx),
which sits in front of `raven` and handles the actual RTMP/RTSP/SRT/WebRTC
traffic. The **Video Streams** tab lists and plays back whatever is currently
publishing; it doesn't hand out separate "stream keys" — publishing
credentials and stream setup work as described below.

## Publishing a stream

Point your encoder (OBS, an EUD's video app, a camera, etc.) at:

```
rtmp://<server>/<path>?user=<username>&pass=<password>
```

- **`<path>`** is whatever name you want this stream to appear under — pick
  something unique per camera/source (e.g. `drone1`, `gate-cam`). It doesn't
  need to be created ahead of time; MediaMTX creates it on first publish and
  it shows up in the Video Streams tab automatically.
- **`<username>` / `<password>` must be a real C4 Raven account** — the same
  credentials used to log into the web UI, not a separate stream key. Every
  publish attempt is checked against the platform's user database.
  - **Use a dedicated, low-privilege account for streaming**, not an admin
    login — the password goes into your encoder's config in plain text, so
    treat it like any other credential you don't want sitting around on a
    field device.
  - If the account has 2FA enabled, note that stream auth is a simple
    username/password check — it does not prompt for a 2FA code.

### If it won't connect

- **Times out / never connects at all** — the port isn't reachable, almost
  always a firewall issue rather than anything in C4 Raven itself. Confirm
  the relevant port (below) is open, e.g. `sudo ufw allow 1935/tcp` for
  plain RTMP, and check for a second firewall layer in front of the server
  (a cloud provider's security group, or a router/hypervisor port-forward)
  if `ufw` already allows it but the port still isn't reachable from
  outside.
- **Connects, then immediately drops with an authentication error** — the
  username/password don't match an existing C4 Raven account. Check under
  **Admin → Users** that the account exists and the password is current;
  reset it there (or from **Profile**, if it's your own account) if unsure.

## Example: publish then view a stream

Publish a webcam or a test file with `ffmpeg`, path `drone1`, account
`streamer`:

```
ffmpeg -re -i /dev/video0 -c:v libx264 -f flv \
  "rtmp://tak.c4raven.net/drone1?user=streamer&pass=YOUR_PASSWORD"
```

**In OBS Studio:** Settings → Stream → Service: *Custom...*

- Server: `rtmp://tak.c4raven.net`
- Stream Key: `drone1?user=streamer&pass=YOUR_PASSWORD`

(OBS joins Server and Stream Key with a `/` to build the same URL as above.)

To view it, either:

- **In the dashboard** — open the Video Streams tab and click **Watch**
  next to `drone1`; it plays back over HLS automatically, no extra setup.
- **Outside the dashboard** — click **Copy HLS Link** (or WebRTC/RTSP) in
  that row and paste it into VLC, `ffplay`, or a browser. The copied link
  already carries whatever the app itself needs to authenticate playback,
  e.g. the HLS link looks like:

  ```
  ffplay "https://tak.c4raven.net/hls/drone1/?jwt=<token copied from the table>"
  ```

## Available protocols

| Protocol | Port | Default firewall state |
|---|---|---|
| RTMP | `1935/tcp` | Not opened by default — publishers typically need this one |
| RTMPS (TLS) | `1936/tcp` | Open |
| RTSP | `8554/tcp` | Not opened by default |
| RTSPS (TLS) | `8322/tcp` | Open |
| SRT | `8890/udp` | Not opened by default |
| WebRTC (playback + publish) | `8889/tcp` signaling, `8189/udp` media | Open |
| HLS (playback) | `8888/tcp` | Open |

If you need a protocol whose port isn't open, add it the same way:
`sudo ufw allow <port>/<tcp|udp>`. Prefer the TLS variant (RTMPS/RTSPS) when
your encoder supports it, since RTMP/RTSP send that account password in the
clear.

## Suggestions

- **Give every source its own path.** Reusing a path for a different camera
  works, but it also means anything with the old link (dashboard tiles,
  playback URLs already copied out) starts showing the new source instead.
- **The Video Streams tab's inline "Watch" preview plays back over HLS.**
  WebRTC has lower latency if you need it for something time-sensitive, but
  you'd consume that link (copyable from the table) outside the dashboard
  yourself — the built-in preview doesn't use it.
- **Recording is opt-in per stream** — toggle it from the Video Streams
  table once a source is live rather than assuming it's being captured.
