import { SPONSORS } from '../data'

export default function Sponsors() {
  return (
    <section className="sponsors">
      <div className="container">
        <p className="sponsors__eyebrow">Our Patrons</p>
        <h2 className="sponsors__heading">Arise Sponsors</h2>
        <div className="sponsors__grid">
          {SPONSORS.map(({ image, name, role }) => (
            <div className="sponsor" key={name}>
              <div className="sponsor__photo">
                <img src={image} alt={name} loading="lazy" decoding="async" />
              </div>
              <h3 className="sponsor__name">{name}</h3>
              <p className="sponsor__role">{role}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
