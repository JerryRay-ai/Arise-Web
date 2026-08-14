import { Fragment } from 'react'
import { ArrowRight } from 'lucide-react'
import { STEPS } from '../data'

export default function HowItWorks() {
  return (
    <section className="how">
      <div className="container">
        <div className="section-head">
                    <h2 className="section-head__title">How It Works</h2>
        </div>
        <div className="how__grid">
          {STEPS.map(({ icon: Icon, number, title, description }, index) => (
            <Fragment key={number}>
              <div className="step">
                <div className="step__badge-wrap">
                  <span className="step__circle">
                    <Icon size={36} strokeWidth={2} />
                  </span>
                  <span className="step__number">{number}</span>
                </div>
                <h3 className="step__title">{title}</h3>
                <p className="step__desc">{description}</p>
              </div>
              {index < STEPS.length - 1 && (
                <span className="how__arrow" aria-hidden="true">
                  <ArrowRight size={24} strokeWidth={2} />
                </span>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  )
}
