import { PROGRAMS } from '../data'

export default function Programs() {
  return (
    <section className="programs">
      <div className="container">
        <h2 className="programs__heading">Our Top Programs</h2>
        <div className="programs__grid">
          {PROGRAMS.map(({ icon: Icon, title, description, image }) => (
            <article className="program-card" key={title}>
              <div className="program-card__image">
                <img src={image} alt={title} loading="lazy" decoding="async" />
              </div>
              <div className="program-card__body">
                <div className="program-card__header">
                  <span className="program-card__icon">
                    <Icon size={18} strokeWidth={2} />
                  </span>
                  <h3 className="program-card__title">{title}</h3>
                </div>
                <p className="program-card__desc">{description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
