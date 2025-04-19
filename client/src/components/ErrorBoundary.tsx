import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode; // Optional: Eine Komponente oder JSX als Fallback
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  // Diese Methode wird aufgerufen, wenn ein Fehler in einer Kindkomponente auftritt.
  // Sie gibt ein State-Update zurück, um anzuzeigen, dass ein Fehler aufgetreten ist.
  public static getDerivedStateFromError(_: Error): State {
    // Aktualisiere den State, damit der nächste Render die Fallback-UI anzeigt.
    return { hasError: true };
  }

  // Diese Methode wird ebenfalls aufgerufen, wenn ein Fehler auftritt.
  // Hier kannst du den Fehler protokollieren.
  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary hat einen Fehler abgefangen:", error, errorInfo);
    // Hier könntest du den Fehler an einen externen Logging-Dienst senden
    // z.B. logErrorToMyService(error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      // Wenn ein Fehler aufgetreten ist, zeige die Fallback-UI an.
      // Das kann eine einfache Nachricht sein oder eine übergebene Fallback-Komponente.
      return this.props.fallback || <h1>Etwas ist schiefgelaufen.</h1>;
    }

    // Normalerweise werden einfach die Kinder gerendert.
    return this.props.children;
  }
}

export default ErrorBoundary; 