import { DIFFERENTIATORS } from '../data'

export default function WhyChoose() {
  return (
    <section className="why">
      <div className="container">
        <div className="section-head">
                    <h2 className="section-head__title">Why Choose ARISE?</h2>
        </div>
        <div className="why__grid">
          {DIFFERENTIATORS.map(({ icon: Icon, title, description }) => (
            <article className="diff-card" key={title}>
              <span className="diff-card__icon">
                <Icon size={24} strokeWidth={2} />
              </span>
              <h3 className="diff-card__title">{title}</h3>
              <p className="diff-card__desc">{description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
