import { useRef, useState } from 'react'
import { Camera, FolderOpen, Paperclip } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera'

// True when running inside the Capacitor app (native camera/gallery dialogs).
const IS_NATIVE = Capacitor.isNativePlatform()

// Converts a data-URL returned by the camera plugin into a Blob.
function dataUrlToBlob(dataUrl?: string): Blob {
  const [meta, b64] = (dataUrl ?? '').split(',')
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg'
  const bin = atob(b64 ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// A single-passport picker: the "Upload" button asks where the photo should
// come from — the device camera or an existing file. In the Capacitor app the
// camera plugin shows its native prompt (camera vs photo library); on the web a
// small inline chooser appears, backed by hidden file inputs (the camera one
// carries `capture` so mobile browsers open the camera directly).
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

  function emitFile(file: File | null) {
    if (file) onFile(file)
  }

  async function nativePick(source: CameraSource) {
    try {
      const photo = await CapCamera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source,
        quality: 88,
        width: 900,
        correctOrientation: true,
      })
      emitFile(new File([dataUrlToBlob(photo.dataUrl)], `passport-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    } catch {
      /* user cancelled */
    }
  }

  async function onUpload() {
    if (IS_NATIVE) {
      // The plugin's own prompt asks "Camera" or "Photo Library".
      await nativePick(CameraSource.Prompt)
    } else {
      setMenuOpen((v) => !v)
    }
  }

  return (
    <div className={`passport-picker${compact ? ' passport-picker--compact' : ''}`}>
      <button type="button" className="passport-picker__btn" onClick={() => void onUpload()}>
        <Paperclip size={16} />
        <span>Upload</span>
      </button>

      {!IS_NATIVE && menuOpen && (
        <div className="passport-picker__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="passport-picker__option"
            onClick={() => {
              setMenuOpen(false)
              cameraRef.current?.click()
            }}
          >
            <Camera size={15} />
            <span>Camera</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="passport-picker__option"
            onClick={() => {
              setMenuOpen(false)
              galleryRef.current?.click()
            }}
          >
            <FolderOpen size={15} />
            <span>Upload</span>
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
    </div>
  )
}