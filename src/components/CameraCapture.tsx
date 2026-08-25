import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, X } from 'lucide-react'

// In-app camera capture using the WebView's own getUserMedia + <canvas>.
//
// Why this exists: launching the system camera through an Intent sends the app
// to the background, and aggressive OEM ROMs (Xiaomi/Redmi HyperOS, Oppo, Vivo,
// Realme…) treat that as a cue to kill the backgrounded WebView activity. On
// return the whole app reloads ("restarts") and the in-progress registration is
// lost. Capturing the photo *inside* the WebView keeps the app in the
// foreground the entire time — no Intent, no backgrounding, nothing for the OS
// to reclaim — so the form is exactly where the user left it.
//
// The captured File is a JPEG, matching what the upload path produces, so the
// passport validator and the upload Edge Function treat it identically.
export default function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // (Re)start the stream whenever the chosen camera changes. The `cancelled`
  // guard ensures a stream that resolves after unmount is stopped immediately,
  // so the camera light never stays on.
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)
    stopStream()
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
        }
        setReady(true)
      } catch (e) {
        if (cancelled) return
        const name = (e as DOMException)?.name
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setError('Camera access was blocked. Please allow the camera permission, then try again.')
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError('No usable camera was found on this device. Use “Photo Library” instead.')
        } else {
          setError('The camera could not be started. Please try again.')
        }
      }
    })()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [facing, stopStream])

  function flip() {
    setFacing((f) => (f === 'environment' ? 'user' : 'environment'))
  }

  function capture() {
    const v = videoRef.current
    if (!v || !ready) return
    const vw = v.videoWidth
    const vh = v.videoHeight
    if (!vw || !vh) return

    // Cap the longest side so the passport stays comfortably under the 5MB
    // limit (the upload path used width 600; a little more detail is fine).
    const MAX = 1200
    const scale = Math.min(1, MAX / Math.max(vw, vh))
    const cw = Math.round(vw * scale)
    const ch = Math.round(vh * scale)

    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, cw, ch)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        stopStream()
        onCapture(new File([blob], `passport-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.85
    )
  }

  function close() {
    stopStream()
    onClose()
  }

  return (
    <div className="camera-capture" role="dialog" aria-modal="true" aria-label="Take a photo">
      <div className="camera-capture__stage">
        {error ? (
          <p className="camera-capture__msg">{error}</p>
        ) : (
          <video ref={videoRef} className="camera-capture__video" autoPlay muted playsInline />
        )}
      </div>

      <div className="camera-capture__controls">
        <button type="button" className="camera-capture__btn" onClick={close}>
          <X size={20} />
          <span>Cancel</span>
        </button>

        <button
          type="button"
          className="camera-capture__shutter"
          onClick={capture}
          disabled={!ready || !!error}
          aria-label="Capture photo"
        >
          <Camera size={26} />
        </button>

        <button
          type="button"
          className="camera-capture__btn"
          onClick={flip}
          disabled={!!error}
          aria-label="Switch camera"
        >
          <RefreshCw size={20} />
          <span>Flip</span>
        </button>
      </div>
    </div>
  )
}
