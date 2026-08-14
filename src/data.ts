import {
  Code2,
  Palette,
  BarChart3,
  Smartphone,
  Hammer,
  Users,
  Briefcase,
  Calendar,
  FileText,
  GraduationCap,
  Rocket,
  Award,
  Lightbulb,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'

export const NAV_LINKS = ['Home', 'About', 'Programs', 'Certificate'] as const

export interface Stat {
  value: string
  label: string
}

// The hero stat band is value-over-label only — no icons.
export const STATS: Stat[] = [
  { value: '500+', label: 'Students trained' },
  { value: '5+', label: 'Programs' },
  { value: '5+', label: 'Expert instructors' },
]

// Faces in the hero "join 500+ students" cluster. Cropped + downscaled from the
// full-res photos in public/assets (hero2 pending a JPG/PNG re-export — it was
// supplied as a Canon .CR2 raw, which browsers can't display).
export const HERO_AVATARS = ['/assets/avatar-hero1.jpg', '/assets/avatar-hero3.jpg']

export interface Program {
  icon: LucideIcon
  title: string
  description: string
  image: string
}

export const PROGRAMS: Program[] = [
  {
    icon: Code2,
    title: 'Web Development',
    description:
      'Master HTML, CSS, JavaScript, and modern frameworks to build responsive, stunning websites from scratch.',
    image: '/assets/webdev.jpg',
  },
  {
    icon: Palette,
    title: 'UI/UX Design',
    description:
      'Discover the art of wireframing, prototyping, and creating modern, user-friendly mobile and web interfaces.',
    image: '/assets/program-uiux.jpg',
  },
  {
    icon: BarChart3,
    title: 'Data Analytics',
    description:
      'Learn how to analyze, visualize, and harness real-world data using Python and machine learning algorithms.',
    image: '/assets/program-data.jpg',
  },
  {
    icon: Smartphone,
    title: 'AI Automation',
    description:
      'Build intelligent workflows that connect apps, automate repetitive tasks using AI agents, and scale business operations without human bottlenecks.',
    image: '/assets/program-ai.jpg',
  },
]

export interface Differentiator {
  icon: LucideIcon
  title: string
  description: string
}

export const DIFFERENTIATORS: Differentiator[] = [
  {
    icon: Hammer,
    title: 'Hands-on Learning',
    description:
      'Learn by doing. Skip pure theory and build real websites, games, and web tools in every single class.',
  },
  {
    icon: Users,
    title: 'Expert Mentors',
    description:
      'Get guided by active tech professionals who care about your growth and break down complex concepts.',
  },
  {
    icon: Briefcase,
    title: 'Career Support',
    description:
      'Prepare your portfolio, practice job interviews, and build connections with growing tech startups.',
  },
  {
    icon: Calendar,
    title: 'Flexible Schedule',
    description: 'Learn at a flexible time that suits your schedule',
  },
]

export interface Testimonial {
  quote: string
  name: string
  role: string
  avatar: string
}

export const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "I was a complete beginner when I joined ARISE. The mentors were patient and supportive, guiding me through every step. Now, I'm confident in operating the system with ease",
    name: 'Gift',
    role: 'Basic Computer Graduate',
    avatar: '/assets/gift.jpg',
  },
  {
    quote:
      "ARISE changed my entire path. The mentors didn't just teach syntax; they taught me how to think like an engineer. I built and launched my first freelance client site",
    name: 'David',
    role: 'Web Development Graduate',
    avatar: '/assets/avatar-david.jpg',
  },
]

export interface Step {
  icon: LucideIcon
  number: number
  title: string
  description: string
}

export const STEPS: Step[] = [
  {
    icon: FileText,
    number: 1,
    title: 'Apply Online',
    description:
      'Select your dream track, fill out a simple questionnaire, and reserve your cohort slot.',
  },
  {
    icon: GraduationCap,
    number: 2,
    title: 'Learn & Build',
    description:
      'Attend interactive code sessions, collaborate on team labs, and receive professional mentorship.',
  },
  {
    icon: Rocket,
    number: 3,
    title: 'Launch & Succeed',
    description:
      'Earn your digital certificate, polish your career portfolio, and lock in tech internship interviews.',
  },
]

export interface Sponsor {
  image: string
  name: string
  role: string
}

export const SPONSORS: Sponsor[] = [
  {
    image: '/assets/sponsor-umo.jpg',
    name: 'His Excellency Pastor Umo Eno',
    role: 'Executive Governor of Akwa Ibom State',
  },
  {
    image: '/assets/sponsor-sunday.jpg',
    name: 'Amb. Sunday Usikhifo',
    role: 'Personal Assistant to the Governor on Voluntary Services and Coordinator Non-indegene Association Akwa Ibom State',
  },
]

export const FOOTER_LINKS = {
  quickLinks: ['Home', 'About', 'Programs', 'Stories', 'Certificate'],
  contact: ['admin@ariseict.com', '+234 707 155 6233', '8 Etuk Street, off Aka Road, Uyo'],
}

// ---------------------------------------------------------------
// About page content
// ---------------------------------------------------------------
export interface CoreValue {
  icon: LucideIcon
  title: string
  description: string
}

export const CORE_VALUES: CoreValue[] = [
  {
    icon: Award,
    title: 'Excellence',
    description:
      'We pursue the highest standards in everything we do, from our curriculum design to our students’ final graduation projects.',
  },
  {
    icon: Lightbulb,
    title: 'Innovation',
    description:
      'We embrace new ideas, evolving technologies, and creative problem-solving to stay ahead in an ever-shifting digital world.',
  },
  {
    icon: Users,
    title: 'Community',
    description:
      'We build together and grow together. Our network of alumni, mentors, and local companies forms a lasting support system.',
  },
  {
    icon: TrendingUp,
    title: 'Impact',
    description:
      'We measure our ultimate success by lives transformed — the career pathways carved, jobs secured, and local problems solved.',
  },
]

export interface Offering {
  title: string
  description: string
}

export const OFFERINGS: Offering[] = [
  {
    title: 'Web Development',
    description:
      'Master frontend and backend engineering. Learn modern JavaScript frameworks, database structures, and high-performance server architectures.',
  },
  {
    title: 'Data Analytics',
    description:
      'Harness data analytics, statistical modeling, and machine learning. Turn raw corporate information into compelling, interactive insights.',
  },
  {
    title: 'UI/UX Design',
    description:
      'Create beautiful, highly functional digital user experiences. Study information architecture, visual hierarchy, user research, and interactive wireframing.',
  },
  {
    title: 'Graphic Design',
    description:
      'Create visually compelling digital and print materials. Master design principles, typography, color theory, and industry-standard software.',
  },
]

export interface StrategicGoal {
  number: number
  title: string
  description: string
}

export const STRATEGIC_GOALS: StrategicGoal[] = [
  {
    number: 1,
    title: 'Train 10,000+ Students by 2027',
    description:
      'Scaling our physical campus capacity and virtual training infrastructure to reach more passionate young minds.',
  },
  {
    number: 2,
    title: 'Achieve 80% Job Placement Rate',
    description:
      'Helping students secure employment within 6 months of graduation through our direct corporate placement partner network.',
  },
  {
    number: 3,
    title: 'Launch a Tech Incubator',
    description:
      'Providing seed funding, dedicated high-speed workspace, and expert legal mentorship for exceptional student-led tech startups.',
  },
  {
    number: 4,
    title: 'Establish 20+ Global Tech Partnerships',
    description:
      'Collaborating with foreign and domestic software firms to provide internships, continuous reviews, and standard job placements.',
  },
]
