import { Routes, Route, useLocation, Outlet } from 'react-router-dom'
import { useEffect, lazy, Suspense, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import Header from './components/Header'
import Footer from './components/Footer'
import Landing from './pages/Landing'

// Landing loads eagerly (it's the entry route); the rest are split into their own
// chunks and fetched on demand, so the first paint ships far less JS. Admin in
// particular drags in the Supabase client, which visitors never need.
const Register = lazy(() => import('./pages/Register'))
const Verify = lazy(() => import('./pages/Verify'))
const About = lazy(() => import('./pages/About'))
const Stories = lazy(() => import('./pages/Stories'))
const StoriesShare = lazy(() => import('./pages/StoriesShare'))
const Admin = lazy(() => import('./pages/Admin'))

// True when running inside the Capacitor Android app (as opposed to the website).
// The native app IS the admin console: it skips the public site entirely.
const IS_NATIVE = Capacitor.isNativePlatform()

// ---- Native app launch splash -------------------------------------------------
// Full-screen brand splash shown while the Admin chunk is preloaded. Holds for a
// minimum of SPLASH_MS so the transition into the login/portal is instant and
// the branded moment lasts a beat rather than a flash.
const SPLASH_MS = 2200

function NativeSplash() {
  useEffect(() => {
    // White splash -> dark status-bar icons and a white bar behind them.
    StatusBar.setStyle({ style: Style.Dark })
    StatusBar.setBackgroundColor({ color: '#ffffff' })
  }, [])
  return (
    <main className="native-splash" role="status" aria-label="Loading ARISE Admin">
      <div className="native-splash__halo" aria-hidden="true" />
      <img className="native-splash__logo" src="/assets/logo.png" alt="ARISE" />
      <p className="native-splash__word">ICT HUB</p>
      <div className="native-splash__bar" aria-hidden="true">
        <span />
      </div>
    </main>
  )
}

function NativeAdmin() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    const preload = import('./pages/Admin')
    const min = new Promise<void>((resolve) => setTimeout(resolve, SPLASH_MS))
    Promise.all([preload, min]).then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
    }
  }, [])
  if (!ready) return <NativeSplash />
  return (
    <Suspense fallback={<NativeSplash />}>
      <Admin />
    </Suspense>
  )
}

// On route change: scroll to a #section target if the URL has one
// (waiting a frame for the landing page to mount), otherwise jump to top.
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const id = hash.slice(1)
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
      })
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [pathname, hash])
  return null
}

// Public site chrome (marketing header + footer) wraps the visitor-facing pages.
// The admin console lives outside it with its own minimal shell.
function PublicLayout() {
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
    </>
  )
}

export default function App() {
  if (IS_NATIVE) return <NativeAdmin />
  return (
    <>
      <ScrollManager />
      <Suspense fallback={<div className="route-fallback" aria-busy="true" />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/about" element={<About />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/stories" element={<Stories />} />
            <Route path="/stories/share" element={<StoriesShare />} />
            <Route path="*" element={<Landing />} />
          </Route>
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </Suspense>
    </>
  )
}
