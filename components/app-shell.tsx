'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookMarked,
  BookOpen,
  BookUp2,
  CalendarClock,
  Download,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import { useLibrary } from '@/components/library-context';
import { LoginScreen } from '@/components/login-screen';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/catalog', label: 'Kitoblar', icon: BookMarked },
  { href: '/students', label: 'O‘quvchilar', icon: Users },
  { href: '/teachers', label: 'O‘qituvchilar', icon: GraduationCap },
  { href: '/issue', label: 'Kitob berish', icon: BookUp2 },
  { href: '/returns', label: 'Qaytarish', icon: RotateCcw },
  { href: '/deadlines', label: 'Monitoring', icon: CalendarClock },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { authLoading, user, logout, downloadFullXlsx } = useLibrary();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeNav = NAV_ITEMS.find((item) => item.href === pathname) ?? NAV_ITEMS[0];

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-xs text-[#64748B]">Yuklanmoqda...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  const sidebarContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-white border-r border-[#E2E8F0]">
      <div className="h-14 flex items-center justify-between border-b border-[#E2E8F0] px-4 shrink-0">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2.5 min-w-0"
        >
          <div className="w-8 h-8 rounded-lg bg-[#1E3A5F] text-white flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-[#0F172A] truncate">
            SCHOOL LIBRARY
          </span>
        </Link>
        {isMobile && (
          <button
            type="button"
            aria-label="Menyuni yopish"
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F1F5F9] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav aria-label="Asosiy menyu" className="flex-1 py-3 px-2.5 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-[#1E3A5F] text-white'
                  : 'text-[#334155] hover:bg-[#F1F5F9] hover:text-[#0F172A]'
              )}
            >
              <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-white' : 'text-[#64748B]')} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[#E2E8F0] flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="text-xs font-medium text-[#0F172A] truncate">{user.displayName}</div>
          <div className="text-[11px] text-[#64748B] truncate">{user.username}</div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          title="Chiqish"
          aria-label="Tizimdan chiqish"
          className="p-2 rounded-lg text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#DC2626] cursor-pointer shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[224px] shrink-0 sticky top-0 h-screen">
        {sidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-[#0F172A]/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 w-[240px] max-w-[82vw] h-full">{sidebarContent(true)}</aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col bg-white">
        <header className="sticky top-0 z-30 h-14 bg-white border-b border-[#E2E8F0] px-4 lg:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Menyuni ochish"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-[#334155] hover:bg-[#F1F5F9] cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-semibold text-[#0F172A] truncate">{activeNav.label}</h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => void downloadFullXlsx()}>
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Umumiy hisobot (XLSX)</span>
              <span className="sm:hidden">XLSX</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1320px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
