import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * Shows an on-screen message for fatal JavaScript errors (including ones thrown while the app's
 * modules load) instead of letting a release build close immediately. This file must not import
 * any game code, so it still works when the game code is what fails.
 */
let reported: string | null = null;
const listeners = new Set<(message: string) => void>();

export function reportCrash(where: string, error: unknown) {
  const detail = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
  reported = `${where}\n\n${detail}`.slice(0, 3500);
  listeners.forEach((listener) => listener(reported!));
}

// Fatal JS errors after launch are shown instead of terminating the app.
try {
  const errorUtils = (globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      if (isFatal) reportCrash('Fatal error', error);
      else previous(error, isFatal);
    });
  }
} catch {
  // Best effort only.
}

export class CrashGuard extends React.Component<{ children?: React.ReactNode }, { message: string | null }> {
  state = { message: reported };

  private listener = (message: string) => this.setState({ message });

  static getDerivedStateFromError(error: unknown) {
    const detail = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    return { message: `Render error\n\n${detail}`.slice(0, 3500) };
  }

  componentDidMount() {
    listeners.add(this.listener);
    if (reported && !this.state.message) this.setState({ message: reported });
  }

  componentWillUnmount() {
    listeners.delete(this.listener);
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>BenTown could not start</Text>
        <Text style={styles.hint}>Please send a photo of this screen to the developer.</Text>
        <ScrollView style={styles.box}>
          <Text style={styles.text} selectable>{this.state.message}</Text>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#14302b', padding: 24, paddingTop: 36 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  hint: { color: '#f2cc79', fontSize: 14, marginTop: 6, marginBottom: 12 },
  box: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, padding: 12 },
  text: { color: '#e9efe1', fontSize: 12 },
});
