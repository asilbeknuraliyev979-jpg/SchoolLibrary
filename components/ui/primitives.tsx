'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => {
    const styles: Record<NonNullable<ButtonProps['variant']>, string> = {
      primary: 'bg-[#1E3A5F] text-white hover:bg-[#152C48] border border-transparent',
      secondary: 'bg-[#F1F5F9] text-[#0F172A] hover:bg-[#E2E8F0] border border-transparent',
      outline: 'bg-white text-[#0F172A] border border-[#CBD5E1] hover:bg-[#F8FAFC]',
      ghost: 'bg-transparent text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] border border-transparent',
      danger: 'bg-[#DC2626] text-white hover:bg-[#B91C1C] border border-transparent',
      success: 'bg-[#059669] text-white hover:bg-[#047857] border border-transparent',
    };
    const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
      sm: 'h-8 px-3 text-xs rounded-lg',
      md: 'h-9 px-4 text-sm rounded-lg',
      lg: 'h-10 px-5 text-sm rounded-lg',
      icon: 'h-9 w-9 p-0 rounded-lg',
    };

    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
          styles[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F]/20 focus-visible:border-[#1E3A5F] disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:opacity-60',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[76px] w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F]/20 focus-visible:border-[#1E3A5F] disabled:cursor-not-allowed disabled:opacity-60',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const SelectField = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-sm text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F]/20 focus-visible:border-[#1E3A5F] disabled:cursor-not-allowed disabled:opacity-60',
      className
    )}
    {...props}
  >
    {children}
  </select>
));
SelectField.displayName = 'SelectField';

export function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-[#334155] mb-1.5">
      {children}
      {required && <span className="text-[#DC2626] ml-0.5">*</span>}
    </label>
  );
}

export function PanelCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('bg-white border border-[#E2E8F0] rounded-[10px]', className)}>
      {children}
    </div>
  );
}

export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0F172A]/40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-[#E2E8F0] bg-white p-6 shadow-xl focus:outline-none max-h-[90vh] overflow-y-auto',
            maxWidth
          )}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-[#0F172A]">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-xs text-[#64748B] mt-1">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Yopish"
              className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SideDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0F172A]/35" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 h-full w-full max-w-xl border-l border-[#E2E8F0] bg-white shadow-2xl flex flex-col focus:outline-none">
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#E2E8F0] shrink-0">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold text-[#0F172A] truncate">
                {title}
              </DialogPrimitive.Title>
              {subtitle && (
                <DialogPrimitive.Description className="text-xs text-[#64748B] mt-0.5 truncate">
                  {subtitle}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Yopish"
              className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function StatusText({
  tone,
  children,
}: {
  tone: 'blue' | 'green' | 'amber' | 'red' | 'slate';
  children: React.ReactNode;
}) {
  const tones: Record<typeof tone, string> = {
    blue: 'text-[#1E3A5F] font-medium',
    green: 'text-[#059669] font-medium',
    amber: 'text-[#D97706] font-medium',
    red: 'text-[#DC2626] font-medium',
    slate: 'text-[#64748B] font-normal',
  };
  return <span className={cn('text-xs whitespace-nowrap', tones[tone])}>{children}</span>;
}
