import { Component, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";

/** Catches a page section that failed to load or render, so the rest of the page stays up, and offers a reload. */
export class LoadBoundary extends Component<{ children: ReactNode; what: string }, { failed: string | null }> {
  state = { failed: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Alert variant="destructive" className="border-trip/40 bg-trip-soft" data-testid="load-failed">
        <CircleAlert />
        <AlertTitle className="line-clamp-none">{this.props.what} did not load</AlertTitle>
        <AlertDescription>
          <p className="[overflow-wrap:anywhere]">{this.state.failed}</p>
          <Button variant="line" size="sm" className="mt-1 h-8" onClick={() => window.location.reload()}>Reload the page</Button>
        </AlertDescription>
      </Alert>
    );
  }
}
