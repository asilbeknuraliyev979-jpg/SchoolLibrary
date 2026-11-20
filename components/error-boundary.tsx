'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Kutilmagan tizim xatoligi yuz berdi.' };
  }

  componentDidCatch(error: Error) {
    console.error('School Library UI ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#E2E8F0] rounded-[14px] p-6 text-center space-y-4">
            <div className="mx-auto w-11 h-11 rounded-[10px] bg-red-50 flex items-center justify-center text-[#DC2626]">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">Xatolik yuz berdi</h2>
              <p className="text-xs text-[#64748B] mt-1 break-words">{this.state.message}</p>
            </div>
            <Button
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
            >
              <RotateCcw className="w-4 h-4" />
              Sahifani yangilash
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
