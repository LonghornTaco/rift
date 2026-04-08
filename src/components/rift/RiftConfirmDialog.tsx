'use client';

import { MigrationPath } from '@/lib/rift/types';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

interface RiftConfirmDialogProps {
  sourceName: string;
  targetName: string;
  paths: MigrationPath[];
  onConfirm: () => void;
  onCancel: () => void;
}

const scopeLabels: Record<string, string> = {
  SingleItem: 'Item only',
  ItemAndChildren: 'Item + children',
  ItemAndDescendants: 'Item + descendants',
};

export function RiftConfirmDialog({
  sourceName,
  targetName,
  paths,
  onConfirm,
  onCancel,
}: RiftConfirmDialogProps) {
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent className="sm:max-w-[480px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Migration</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                You are about to push <strong>{paths.length} {paths.length === 1 ? 'path' : 'paths'}</strong> from{' '}
                <strong>{sourceName}</strong> to <strong>{targetName}</strong>.
              </p>

              {/* Path list */}
              <div className="max-h-[200px] overflow-y-auto border border-border rounded-md bg-muted/50 p-2.5">
                {paths.map((p) => {
                  const segments = p.itemPath.split('/');
                  const truncated =
                    segments.length > 3
                      ? '.../' + segments.slice(-2).join('/')
                      : p.itemPath;
                  return (
                    <div
                      key={p.itemPath}
                      className="text-xs text-foreground py-1 flex justify-between"
                      title={p.itemPath}
                    >
                      <span className="font-mono">{truncated}</span>
                      <span className="text-muted-foreground ml-4 shrink-0">
                        {scopeLabels[p.scope]}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="text-sm text-destructive">
                This will overwrite existing content in <strong>{targetName}</strong>.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
