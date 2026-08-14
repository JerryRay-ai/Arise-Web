import { Link } from 'react-router-dom'
import { Facebook } from 'lucide-react'
import { FOOTER_LINKS } from '../data'

// Where each Quick Link points.
const QUICK_LINK_TARGETS: Record<string, string> = {
  Home: '/',
  About: '/about',
  Programs: '/#programs',
  Stories: '/stories',
  Certificate: '/verify',
}

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner container">
        <div className="footer__brand">
          <div className="footer__brand-head">
            <span className="footer__logo-badge">
              <img src="/assets/logo-footer.png" alt="" />
            </span>
            <span className="footer__brand-name">ARISE ICT HUB</span>
          </div>
          <p className="footer__tagline">
            Empowering young minds with modern digital capabilities. Accelerating the transition to
            tech literacy and high-impact digital careers.
          </p>
        </div>

        <div className="footer__col footer__col--links">
          <h4 className="footer__title">Quick Links</h4>
          <ul className="footer__list">
            {FOOTER_LINKS.quickLinks.map((link) => (
              <li key={link}>
                <Link to={QUICK_LINK_TARGETS[link] ?? '/'}>{link}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="footer__col">
          <h4 className="footer__title">Contact Us</h4>
          <ul className="footer__list">
            {FOOTER_LINKS.contact.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="footer__col">
          <h4 className="footer__title">Connect</h4>
          <a className="footer__social" href="#" aria-label="Facebook">
            <Facebook size={18} strokeWidth={2} />
          </a>
        </div>
      </div>

      <div className="footer__bottom container">
        <p>© 2026 ARISE Tech Hub. All rights reserved.</p>
        <div className="footer__legal">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
        </div>
      </div>
    </footer>
  )
}
