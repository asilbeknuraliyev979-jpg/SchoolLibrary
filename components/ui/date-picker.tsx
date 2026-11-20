'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatYmdDisplay } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

const UZ_MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
];

const UZ_WEEKDAYS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

function ymdToLocalDate(ymd: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function localDateToYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function DatePicker({
  value,
  onChange,
  minYmd,
  label = 'Sanani tanlang',
  id,
  className,
}: {
  value: string;
  onChange: (ymd: string) => void;
  minYmd?: string;
  label?: string;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selectedDate = ymdToLocalDate(value);
  const minDate = minYmd ? ymdToLocalDate(minYmd) : undefined;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          id={id}
          type="button"
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F]/20 focus-visible:border-[#1E3A5F] transition-colors cursor-pointer',
            className
          )}
        >
          <span className="tabular-nums font-mono text-xs">
            {value ? formatYmdDisplay(value) : label}
          </span>
          <CalendarIcon className="h-4 w-4 text-[#64748B]" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-[10px] border border-[#E2E8F0] bg-white p-3 shadow-lg"
        >
          <DayPicker
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            disabled={minDate ? { before: minDate } : undefined}
            onSelect={(d) => {
              if (d) {
                onChange(localDateToYmd(d));
                setOpen(false);
              }
            }}
            formatters={{
              formatCaption: (month) => `${UZ_MONTHS[month.getMonth()]} ${month.getFullYear()}`,
              formatWeekdayName: (d) => UZ_WEEKDAYS[d.getDay()],
            }}
            classNames={{
              root: 'text-sm text-[#0F172A]',
              months: 'flex flex-col',
              month: 'space-y-2',
              month_caption: 'flex items-center justify-between px-1 py-1 font-semibold text-sm',
              nav: 'flex items-center gap-1',
              button_previous:
                'h-7 w-7 inline-flex items-center justify-center rounded-md border border-[#E2E8F0] hover:bg-[#F1F5F9] cursor-pointer',
              button_next:
                'h-7 w-7 inline-flex items-center justify-center rounded-md border border-[#E2E8F0] hover:bg-[#F1F5F9] cursor-pointer',
              month_grid: 'w-full border-collapse',
              weekdays: 'grid grid-cols-7 text-center',
              weekday: 'text-[11px] font-medium text-[#64748B] py-1',
              week: 'grid grid-cols-7 mt-0.5',
              day: 'p-0.5 text-center',
              day_button:
                'h-8 w-8 rounded-lg text-xs tabular-nums hover:bg-[#EEF2F7] hover:text-[#1E3A5F] transition-colors cursor-pointer',
              selected: '[&>button]:bg-[#1E3A5F] [&>button]:text-white [&>button]:hover:bg-[#152C48]',
              today: '[&>button]:border [&>button]:border-[#1E3A5F] [&>button]:font-semibold',
              outside: 'opacity-35',
              disabled: 'opacity-30 pointer-events-none',
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === 'left' ? (
                  <ChevronLeft className="h-4 w-4 text-[#475569]" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-[#475569]" />
                ),
            }}
          />
          <div className="mt-2 pt-2 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
            <label className="text-[11px] text-[#64748B]" htmlFor={`${id ?? 'dp'}-raw`}>
              Sana (YYYY-MM-DD)
            </label>
            <input
              id={`${id ?? 'dp'}-raw`}
              type="date"
              value={value}
              min={minYmd}
              onChange={(e) => {
                if (e.target.value) {
                  onChange(e.target.value);
                  setOpen(false);
                }
              }}
              className="h-7 rounded-md border border-[#E2E8F0] px-2 text-xs font-mono text-[#0F172A]"
            />
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
