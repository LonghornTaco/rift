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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface RiftConfirmDialogProps {
  sourceName: string;
  targetName: string;
  paths: MigrationPath[];
  recycleOrphans: boolean;
  onRecycleOrphansChange: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const scopeLabels: Record<MigrationPath['scope'], string> = {
  SingleItem: 'Item only',
  ItemAndChildren: 'Item + children',
  ItemAndDescendants: 'Item + descendants',
};

export function RiftConfirmDialog({
  sourceName,
  targetName,
  paths,
  recycleOrphans,
  onRecycleOrphansChange,
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

              <div className="flex items-center gap-2">
                <Checkbox
                  id="recycle-orphans"
                  checked={recycleOrphans}
                  onCheckedChange={(checked) => onRecycleOrphansChange(checked === true)}
                />
                <Label htmlFor="recycle-orphans" className="text-sm text-foreground cursor-pointer">
                  Recycle items on target that no longer exist on source
                </Label>
              </div>
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
