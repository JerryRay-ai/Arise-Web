import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { STATS, HERO_AVATARS } from '../data'

// Hero background slides, crossfaded in order. `mod` gives each photo its own
// crop class so mobile can frame each one differently (see .hero__slide--* CSS).
const HERO_SLIDES = [
  { src: '/assets/hero-bg.jpg', mod: 'classroom' },
  { src: '/assets/program-web.jpg', mod: 'building' },
]
const SLIDE_MS = 6000

export default function Hero() {
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (HERO_SLIDES.length < 2) return
    // Honour reduced-motion: hold on the first slide instead of auto-cycling.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduce.matches) return
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % HERO_SLIDES.length)
    }, SLIDE_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <section className="hero">
      <div className="hero__bg">
        {HERO_SLIDES.map(({ src, mod }, i) => (
          <img
            key={src}
            className={`hero__slide hero__slide--${mod}${i === active ? ' is-active' : ''}`}
            src={src}
            alt=""
            aria-hidden="true"
            // Only the first slide blocks paint; the rest can arrive lazily.
            loading={i === 0 ? 'eager' : 'lazy'}
          />
        ))}
        <div className="hero__overlay" />
      </div>

      {HERO_SLIDES.length > 1 && (
        <div className="hero__dots" role="tablist" aria-label="Hero slides">
          {HERO_SLIDES.map(({ src }, i) => (
            <button
              key={src}
              type="button"
              className={`hero__dot${i === active ? ' is-active' : ''}`}
              aria-label={`Show slide ${i + 1}`}
              aria-selected={i === active}
              role="tab"
              onClick={() => setActive(i)}
            />
          ))}
        </div>
      )}

      <div className="hero__content container">
          <h1 className="hero__title">
          Empowering Young Minds with <em>Digital Skills</em>
        </h1>
        <p className="hero__subtitle">
          Build practical skills and launch your future with hands-on programs, mentorship, and
          career-ready projects.
        </p>
        <div className="hero__actions">
          <Link className="btn btn--primary" to="/register">
            Enroll Now
          </Link>
          <Link className="btn btn--outline" to="/#programs">
            Explore Courses
          </Link>
        </div>
        <div className="hero__social">
          <div className="hero__avatars">
            {HERO_AVATARS.map((src) => (
              <img key={src} className="hero__avatar" src={src} alt="" loading="lazy" />
            ))}
          </div>
          <span className="hero__social-text">Join 500+ students already learning with us</span>
        </div>
      </div>

      <div className="stats">
        {STATS.map(({ value, label }) => (
          <div className="stat" key={label}>
            <span className="stat__value">{value}</span>
            <span className="stat__label">{label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
