import type { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

/**
 * A modal that is a dialog on a desktop and a sheet from the bottom on a phone.
 *
 * A centred dialog on a phone is the worst of both: it fights the on-screen
 * keyboard, and its close button sits at the top of the screen, farthest from
 * the thumb. The drawer slides up from where the hand already is, and grows
 * with its content instead of being centred in a viewport the keyboard halves.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          {/* pb keeps the last field clear of the home indicator. */}
          <div className={cnScroll(className)}>{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className={`flex-1 overflow-y-auto -mx-1 px-1 ${className ?? ''}`}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}

function cnScroll(className?: string): string {
  return `overflow-y-auto px-4 pb-8 ${className ?? ''}`;
}
