import Hero from '../components/Hero'
import Programs from '../components/Programs'
import WhyChoose from '../components/WhyChoose'
import Testimonials from '../components/Testimonials'
import HowItWorks from '../components/HowItWorks'
import Sponsors from '../components/Sponsors'
import useReveal from '../useReveal'

export default function Landing() {
  useReveal()

  return (
    <main>
      <Hero />
      <div id="programs" data-reveal>
        <Programs />
      </div>
      <div id="about" data-reveal>
        <WhyChoose />
      </div>
      <div data-reveal>
        <Testimonials />
      </div>
      <div id="how-it-works" data-reveal>
        <HowItWorks />
      </div>
      <div data-reveal>
        <Sponsors />
      </div>
    </main>
  )
}
