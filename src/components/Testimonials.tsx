import { Link } from 'react-router-dom'
import { TESTIMONIALS } from '../data'

export default function Testimonials() {
  return (
    <section className="testimonials">
      <div className="container">
        <div className="section-head">
          <h2 className="section-head__title">Success Stories from Our Alumni</h2>
        </div>
        <div className="testimonials__grid">
          {TESTIMONIALS.map(({ quote, name, role, avatar }) => (
            <article className="testimonial-card" key={name}>
              <span className="testimonial-card__quote" aria-hidden="true">
                &ldquo;
              </span>
              <p className="testimonial-card__text">{quote}</p>
              <div className="testimonial-card__author">
                <img className="testimonial-card__avatar" src={avatar} alt={name} loading="lazy" decoding="async" />
                <div className="testimonial-card__meta">
                  <span className="testimonial-card__name">{name}</span>
                  <span className="testimonial-card__role">{role}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="section-cta">
          <Link className="btn btn--primary" to="/stories">
            See more stories
          </Link>
        </div>
      </div>
    </section>
  )
}
