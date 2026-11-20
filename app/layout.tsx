import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';
import { ErrorBoundary } from '@/components/error-boundary';
import { LibraryProvider } from '@/components/library-context';
import { AppShell } from '@/components/app-shell';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'School Library — Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi',
  description:
    'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi uchun kutubxona inventari, o‘quvchilar, kitob berish-qaytarish, qaytarish muddatlari va Excel hisobotlarini boshqarish tizimi.',
  openGraph: {
    title: 'School Library — Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi',
    description:
      'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi uchun kutubxona boshqaruv tizimi.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'School Library — Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi',
    description:
      'Kattaqo‘rg‘on tuman ixtisoslashtirilgan maktabi uchun kutubxona boshqaruv tizimi.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning className="min-h-screen bg-[#F8FAFC] text-[#0F172A] antialiased">
        <ErrorBoundary>
          <LibraryProvider>
            <AppShell>{children}</AppShell>
          </LibraryProvider>
        </ErrorBoundary>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
