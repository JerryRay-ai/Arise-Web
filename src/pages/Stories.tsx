import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSupabase } from '../lib/supabase'
import type { PublicExperience } from '../lib/types'
import { TESTIMONIALS } from '../data'
import useReveal from '../useReveal'

type Status = 'loading' | 'ready' | 'error'

// Approved alumni stories are cached locally so repeat visitors see them the
// moment the page paints — alongside the featured testimonials — instead of
// waiting for the database round-trip. The cache is refreshed in the background.
const STORIES_CACHE_KEY = 'arise.stories.approved'

function readCache(): PublicExperience[] | null {
  try {
    const raw = localStorage.getItem(STORIES_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { rows?: unknown }
    return Array.isArray(parsed.rows) ? (parsed.rows as PublicExperience[]) : null
  } catch {
    return null
  }
}

// One shape for the grid: featured testimonials carry a photo, alumni
// submissions fall back to an initials chip.
type StoryCardData = {
  id: string
  name: string
  role: string
  text: string
  avatar?: string
}

// First letter of the first two words, e.g. "Blockchain David" -> "BD".
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const second = parts[1]?.[0] ?? ''
  return (first + second).toUpperCase() || '?'
}

// The curated testimonials shown on the landing page always lead the hub, so
// it's never empty and opens with our most polished stories.
const FEATURED: StoryCardData[] = TESTIMONIALS.map((t) => ({
  id: `featured-${t.name}`,
  name: t.name,
  role: t.role,
  text: t.quote,
  avatar: t.avatar,
}))

function StoryCard({ card }: { card: StoryCardData }) {
  return (
    <article className="story-card">
      <span className="story-card__quote" aria-hidden="true">
        &ldquo;
      </span>
      <p className="story-card__text">{card.text}</p>
      <div className="story-card__author">
        {card.avatar ? (
          <img
            className="story-card__avatar story-card__avatar--photo"
            src={card.avatar}
            alt={card.name}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="story-card__avatar" aria-hidden="true">
            {initials(card.name)}
          </span>
        )}
        <div className="story-card__meta">
          <span className="story-card__name">{card.name}</span>
          <span className="story-card__role">{card.role}</span>
        </div>
      </div>
    </article>
  )
}

export default function Stories() {
  useReveal()
  const cached = useRef(readCache())
  const [rows, setRows] = useState<PublicExperience[]>(cached.current ?? [])
  const [status, setStatus] = useState<Status>(cached.current ? 'ready' : 'loading')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const supabase = getSupabase()
        const { data, error: rpcErr } = await supabase.rpc('list_approved_experiences')
        if (rpcErr) throw new Error(rpcErr.message)
        if (!active) return
        const fresh = (data ?? []) as PublicExperience[]
        setRows(fresh)
        setStatus('ready')
        try {
          localStorage.setItem(
            STORIES_CACHE_KEY,
            JSON.stringify({ fetchedAt: Date.now(), rows: fresh })
          )
        } catch {
          /* cache disabled — the page still works */
        }
      } catch {
        if (!active) return
        setStatus(cached.current ? 'ready' : 'error')
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const submitted: StoryCardData[] = rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    role: r.program ? `${r.program} Graduate` : 'ARISE Alumni',
    text: r.experience,
  }))

  // Featured stories lead; approved submissions follow (newest first).
  const cards = [...FEATURED, ...submitted]

  return (
    <main className="page stories">
      <div className="container">
        <div className="section-head">
                    <h2 className="section-head__title">Alumni Success Stories</h2>
          <p className="about-section__sub">
            Real experiences from people who trained at ARISE ICT Hub.
          </p>
        </div>

        <div className="section-cta">
          <Link className="btn btn--primary" to="/stories/share">
            Share your story
          </Link>
        </div>

        <div className="story-grid" data-reveal>
          {cards.map((card) => (
            <StoryCard key={card.id} card={card} />
          ))}

          {status === 'loading' && (
            <>
              {[0, 1, 2].map((i) => (
                <div className="story-card story-card--skeleton" key={i} aria-hidden="true">
                  <span className="story-card__skeleton-line" />
                  <span className="story-card__skeleton-line story-card__skeleton-line--short" />
                  <span className="story-card__skeleton-author">
                    <span className="story-card__skeleton-avatar" />
                    <span>
                      <span className="story-card__skeleton-line" />
                      <span className="story-card__skeleton-line story-card__skeleton-line--shorter" />
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {status === 'error' && (
          <p className="stories__note">
            Showing featured stories — more couldn’t be loaded right now.
          </p>
        )}
      </div>
    </main>
  )
}
