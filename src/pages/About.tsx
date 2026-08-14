import { Link } from 'react-router-dom'
import { CORE_VALUES, OFFERINGS, STRATEGIC_GOALS } from '../data'
import useReveal from '../useReveal'

// Decorative section photos. These files live in /public/assets — drop in the
// real images to replace the fallback tint (a missing background-image simply
// shows the brand-tinted panel underneath, never a broken-image icon).
const bg = (src: string) => ({ backgroundImage: `url(${src})` })

export default function About() {
  useReveal()

  return (
    <main className="about">
      {/* ---- Hero ---- */}
      <section className="about-hero">
        <div className="container about-hero__inner">
          <h1 className="about-hero__title">
            About <span>Arise ICT Hub</span>
          </h1>
          <p className="about-hero__sub">
            The A.R.I.S.E ICT CENTER is established as the Digital Transformation Catalyst and the essential implementation arm for the State's massive skills acquisition mandate under the ARISE agenda. This blueprint outlines our unwavering commitment to professional excellence, self-sustaining operations, and measurable impact across the public service, entrepreneurial ecosystem, and youth workforce.
          </p>
        </div>
        <div className="container">
          <div
            className="about-hero__banner about-media"
            style={bg('/assets/about-hero.jpg')}
            role="img"
            aria-label="Students learning at Arise ICT Hub"
          />
        </div>
      </section>

      {/* ---- Who We Are ---- */}
      <section className="about-split" data-reveal>
        <div className="container about-split__inner">
          <div className="about-split__text">
            <h2 className="about-split__title">Who We Are</h2>
            <p className="about-split__para">
              Arise ICT Hub is a premier technology training center based in Uyo, Akwa Ibom State,
              dedicated to bridging the digital skills gap among youths in South-South Nigeria.
            </p>
            <p className="about-split__para">
              Founded with a relentless mission to make premium tech education highly accessible,
              intensely practical, and directly career-driven, we help students transition from pure
              novices to job-ready digital professionals. Our workspace is built for absolute
              creativity, peer collaboration, and experiential learning.
            </p>
          </div>
          <div
            className="about-split__media about-media"
            style={bg('/assets/about-team.png')}
            role="img"
            aria-label="The Arise ICT Hub team collaborating"
          />
        </div>
      </section>

      {/* ---- Vision ---- */}
      <section className="about-split about-split--green about-split--reverse" data-reveal>
        <div className="container about-split__inner">
          <div
            className="about-split__media about-media"
            style={bg('/assets/about-vision.png')}
            role="img"
            aria-label="Digital map of Nigeria"
          />
          <div className="about-split__text">
            <p className="about-split__eyebrow">Our Vision</p>
            <h2 className="about-split__title">Leading Innovation in South-South Nigeria</h2>
            <p className="about-split__para">
              To be the leading Digital Transformation Catalyst for Akwa Ibom State, 
              building a future where every citizen is digitally empowered contributing to a modern, 
              e-governed public service and a highly competitive local economy.
            </p>
          </div>
        </div>
      </section>

      {/* ---- Mission ---- */}
      <section className="about-split" data-reveal>
        <div className="container about-split__inner">
          <div className="about-split__text">
            <p className="about-split__eyebrow">Our Mission</p>
            <h2 className="about-split__title">Practical, Career-Driven Education</h2>
            <p className="about-split__para">
              Our commitment is to deliver practical, in-demand ICT education, acting as the essential implementation arm for A.R.I.S.E. agenda's commitment to massive skills acquisition. We function as the primary knowledge hub supporting the public sector's digital migration and enabling entrepreneurs to drive sustainable business growth.
            </p>
          </div>
          <div
            className="about-split__media about-media"
            style={bg('/assets/about-mission.png')}
            role="img"
            aria-label="A developer working at a keyboard"
          />
        </div>
      </section>

      {/* ---- Core Values ---- */}
      <section className="about-values" data-reveal>
        <div className="container">
          <div className="section-head">
            <h2 className="section-head__title">Our Core Values</h2>
            <p className="about-section__sub">
              The non-negotiable principles that drive our curriculum, student support, and workspace
              culture every day.
            </p>
          </div>
          <div className="about-values__grid">
            {CORE_VALUES.map(({ icon: Icon, title, description }) => (
              <article className="value-card" key={title}>
                <span className="value-card__icon">
                  <Icon size={22} strokeWidth={2} />
                </span>
                <h3 className="value-card__title">{title}</h3>
                <p className="value-card__desc">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---- What We Offer ---- */}
      <section className="about-offer" data-reveal>
        <div className="container">
          <div className="section-head">
            <h2 className="section-head__title">What We Offer</h2>
            <p className="about-section__sub">
              Our flagship interactive training programs are thoroughly built to match high-demand
              global job descriptions.
            </p>
          </div>
          <div className="about-offer__grid">
            {OFFERINGS.map(({ title, description }) => (
              <article className="offer-card" key={title}>
                <h3 className="offer-card__title">{title}</h3>
                <p className="offer-card__desc">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Strategic Goals ---- */}
      <section className="about-goals" data-reveal>
        <div className="container about-goals__inner">
          <div className="about-goals__text">
            <div className="section-head section-head--left">
              <h2 className="section-head__title">Our Strategic Goals</h2>
              <p className="about-section__sub">
                How we measure our corporate focus as we expand digital capabilities across West
                Africa in the coming years.
              </p>
            </div>
            <ol className="goals">
              {STRATEGIC_GOALS.map(({ number, title, description }) => (
                <li className="goal" key={number}>
                  <span className="goal__num">{number}</span>
                  <div className="goal__body">
                    <h3 className="goal__title">{title}</h3>
                    <p className="goal__desc">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div
            className="about-goals__media about-media"
            style={bg('/assets/about-goals.jpg')}
            role="img"
            aria-label="Arise ICT Hub graduates celebrating"
          />
        </div>
      </section>

      {/* ---- CTA ---- */}
      <section className="about-cta" data-reveal>
        <div className="container about-cta__inner">
          <h2 className="about-cta__title">Ready to Start Your Tech Journey?</h2>
          <p className="about-cta__sub">
            Take the first step toward a global digital career. Secure your seat in our next
            intensive cohort and learn high-value digital skills from active industry practitioners.
          </p>
          <div className="about-cta__actions">
            <Link className="btn btn--primary" to="/register">
              Enroll Now
            </Link>
            <Link className="btn btn--cta-ghost" to="/#programs">
              View Programs
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
