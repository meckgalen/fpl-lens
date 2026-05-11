import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <table className={cn('w-full caption-bottom text-sm', className)}>{children}</table>;
}

export function TableHeader({ children }: { children: ReactNode }) {
  return <thead className="[&_tr]:border-b [&_tr]:border-border">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="[&_tr:last-child]:border-0">{children}</tbody>;
}

export function TableRow({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </tr>
  );
}

export function TableHead({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={cn(
        'h-10 px-3 text-left align-middle text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground whitespace-nowrap',
        onClick && 'cursor-pointer select-none hover:text-foreground',
        className
      )}
    >
      {children}
    </th>
  );
}

export function TableCell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>;
}
