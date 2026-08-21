import type {Metadata} from 'next'
import {Archivo, IBM_Plex_Mono} from 'next/font/google'

import './globals.css'

const sans = Archivo({variable: '--font-archivo', subsets: ['latin'], display: 'swap'})
const mono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {default: 'Meridian', template: '%s — Meridian'},
  description: 'Physiotherapy and rehabilitation. Book an appointment.',
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${mono.variable}`}>
      <body className="antialiased">
        {/*
          Hidden until focused, then a real link to a real `<main id="main">`.
          The header is persistent chrome and the staff view adds a sidebar on
          top of it, so without this a keyboard user re-tabs the same furniture
          on every page before reaching anything that differs.
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:border-2 focus:border-accent focus:bg-surface focus:px-4 focus:py-2 focus:font-medium"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
