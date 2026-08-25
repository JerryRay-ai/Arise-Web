import { useRef, useState } from 'react'
import { Camera, FolderOpen, Paperclip } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera'
import CameraCapture from './CameraCapture'

// True when running inside the Capacitor app (native camera/gallery dialogs).
const IS_NATIVE = Capacitor.isNativePlatform()

// A single-passport picker: the "Upload" button opens a small chooser —
// "Camera" or "Photo Library".
//
// • Camera: inside the Capacitor app this is an in-WebView capture
//   (see CameraCapture) so the app never goes to the background — aggressive
//   OEM ROMs (Xiaomi/Redmi HyperOS, …) used the old system-camera Intent as a
//   cue to kill the app and reload the whole registration mid-form. On the web
//   it's a hidden file input carrying `capture` so mobile browsers open the
//   camera directly.
// • Photo Library: the Capacitor plugin's gallery picker (Uri result → File),
//   or a plain hidden file input on the web.
export default function PassportPicker({
  onFile,
  compact,
}: {
  onFile: (file: File) => void
  compact?: boolean
}) {
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [camOpen, setCamOpen] = useState(false)

  function emitFile(file: File | null) {
    if (file) onFile(file)
  }

  // Native gallery pick. Uri (not DataUrl) keeps the memory footprint tiny, and
  // picking from the library is lightweight enough that it doesn't trigger the
  // OEM "kill the backgrounded app" behaviour the camera Intent did.
  async function nativeLibrary() {
    try {
      const photo = await CapCamera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos,
        quality: 80,
        width: 600,
        correctOrientation: true,
      })
      const src = photo.webPath
      if (!src) return
      const blob = await fetch(src).then((r) => r.blob())
      const type = (blob.type || '').toLowerCase() === 'image/png' ? 'image/png' : 'image/jpeg'
      const ext = type === 'image/png' ? 'png' : 'jpg'
      emitFile(new File([blob], `passport-${Date.now()}.${ext}`, { type }))
    } catch {
      /* user cancelled */
    }
  }

  function chooseCamera() {
    setMenuOpen(false)
    if (IS_NATIVE) setCamOpen(true)
    else cameraRef.current?.click()
  }

  function chooseLibrary() {
    setMenuOpen(false)
    if (IS_NATIVE) void nativeLibrary()
    else galleryRef.current?.click()
  }

  return (
    <div className={`passport-picker${compact ? ' passport-picker--compact' : ''}`}>
      <button
        type="button"
        className="passport-picker__btn"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Paperclip size={16} />
        <span>Upload</span>
      </button>

      {menuOpen && (
        <div className="passport-picker__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="passport-picker__option"
            onClick={chooseCamera}
          >
            <Camera size={15} />
            <span>Camera</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="passport-picker__option"
            onClick={chooseLibrary}
          >
            <FolderOpen size={15} />
            <span>Photo Library</span>
          </button>
        </div>
      )}

      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={(e) => {
          setMenuOpen(false)
          emitFile(e.target.files?.[0] ?? null)
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        hidden
        onChange={(e) => {
          setMenuOpen(false)
          emitFile(e.target.files?.[0] ?? null)
        }}
      />

      {IS_NATIVE && camOpen && (
        <CameraCapture
          onCapture={(file) => {
            setCamOpen(false)
            emitFile(file)
          }}
          onClose={() => setCamOpen(false)}
        />
      )}
    </div>
  )
}
