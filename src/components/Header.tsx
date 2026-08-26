import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X, ArrowRight } from 'lucide-react'

type NavItem = { label: string; to: string }

const NAV: NavItem[] = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
  { label: 'Programs', to: '/#programs' },
  { label: 'Stories', to: '/stories' },
  { label: 'Certificate', to: '/verify' },
]

export default function Header() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { pathname, hash } = useLocation()
  const close = () => setOpen(false)

  // Inner pages have no hero behind the bar, so keep it in its solid state.
  const isInner = pathname !== '/'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isActive = (to: string) => {
    if (to === '/') return pathname === '/' && !hash
    if (to.startsWith('/#')) return pathname === '/' && hash === to.slice(1)
    return pathname === to
  }

  return (
    <header className={`header${scrolled || isInner ? ' header--scrolled' : ''}`}>
      <div className="header__inner container">
        <Link className="header__brand" to="/" onClick={close} aria-label="ARISE ICT HUB — home">
          <img src="/assets/logo.png" alt="" />
        </Link>
        <button
          type="button"
          className="header__toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={26} strokeWidth={2} /> : <Menu size={26} strokeWidth={2} />}
        </button>

        <nav className={`header__nav${open ? ' header__nav--open' : ''}`}>
          {NAV.map((item) => (
            <Link
              key={item.label}
              className="header__link"
              to={item.to}
              onClick={close}
              aria-current={isActive(item.to) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
          <span className="header__divider" aria-hidden="true" />
          <Link className="btn btn--enroll" to="/register" onClick={close}>
            Enroll Now
            <ArrowRight size={16} strokeWidth={2.5} />
          </Link>
        </nav>
      </div>
    </header>
  )
}
