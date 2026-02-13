"use client";

import { useState } from "react";
import { AlertTriangle, Power, Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useFlattenConfig,
  useSetFlattenEnabled,
  useFlattenAllPositions,
} from "@/lib/hooks/use-account";

interface FlattenControlsProps {
  refreshInterval?: number;
}

export function FlattenControls({ refreshInterval = 30000 }: FlattenControlsProps) {
  const { data: config, isLoading, error } = useFlattenConfig(refreshInterval);
  const setEnabledMutation = useSetFlattenEnabled();
  const flattenMutation = useFlattenAllPositions();
  const [flattenDialogOpen, setFlattenDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleToggleEnabled = (checked: boolean) => {
    setEnabledMutation.mutate(checked, {
      onSuccess: () => {
        setSuccessMessage(
          `Flatten scheduler ${checked ? "enabled" : "disabled"} successfully`
        );
        setTimeout(() => setSuccessMessage(null), 3000);
      },
      onError: (err: Error) => {
        setErrorMessage(`Failed to update flatten scheduler: ${err.message}`);
        setTimeout(() => setErrorMessage(null), 5000);
      },
    });
  };

  const handleFlattenNow = () => {
    setFlattenDialogOpen(true);
  };

  const confirmFlattenNow = () => {
    flattenMutation.mutate(undefined, {
      onSuccess: (result) => {
        if (result.error) {
          setErrorMessage(result.error);
          setTimeout(() => setErrorMessage(null), 5000);
        } else {
          setSuccessMessage(
            `Flatten complete: ${result.flattened.length} position(s) closed`
          );
          setTimeout(() => setSuccessMessage(null), 5000);
        }
        setFlattenDialogOpen(false);
      },
      onError: (err: Error) => {
        setErrorMessage(`Flatten failed: ${err.message}`);
        setTimeout(() => setErrorMessage(null), 5000);
        setFlattenDialogOpen(false);
      },
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            EOD Flatten Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            EOD Flatten Controls
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
            <p className="text-sm text-red-400">
              Failed to load flatten config: {error.message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            EOD Flatten Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Success/Error Messages */}
          {successMessage && (
            <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3">
              <p className="text-sm text-emerald-400">{successMessage}</p>
            </div>
          )}
          {errorMessage && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
              <p className="text-sm text-red-400">{errorMessage}</p>
            </div>
          )}

          {/* Status Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge
                variant={config?.enabled ? "default" : "outline"}
                className={
                  config?.enabled
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border-red-500/20"
                }
              >
                {config?.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Scheduled Time</span>
              <span className="font-mono text-sm">{config?.time || "—"}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Fired Today</span>
              <Badge variant="outline" className="text-xs">
                {config?.firedToday ? "Yes" : "No"}
              </Badge>
            </div>
          </div>

          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between pt-2 border-t">
            <Label htmlFor="flatten-enabled" className="text-sm cursor-pointer">
              Enable Auto-Flatten
            </Label>
            <Switch
              id="flatten-enabled"
              checked={config?.enabled || false}
              onCheckedChange={handleToggleEnabled}
              disabled={setEnabledMutation.isPending}
            />
          </div>

          {/* Manual Flatten Button */}
          <Button
            variant="destructive"
            className="w-full"
            onClick={handleFlattenNow}
            disabled={flattenMutation.isPending}
          >
            <Power className="h-4 w-4 mr-2" />
            Flatten Now
          </Button>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={flattenDialogOpen} onOpenChange={setFlattenDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Flatten All Positions
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will close ALL positions and cancel ALL orders immediately using
              market orders. This action cannot be undone.
              <br />
              <br />
              <span className="font-semibold text-foreground">
                Are you sure you want to proceed?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={flattenMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmFlattenNow}
              disabled={flattenMutation.isPending}
              className="bg-red-500 hover:bg-red-600"
            >
              {flattenMutation.isPending ? "Flattening..." : "Yes, Flatten All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
