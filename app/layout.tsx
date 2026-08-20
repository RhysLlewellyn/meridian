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
      <body className="antialiased">{children}</body>
    </html>
  )
}
