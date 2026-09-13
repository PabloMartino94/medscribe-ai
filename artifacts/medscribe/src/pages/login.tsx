import { useState, type FormEvent } from 'react';
import { Loader2, Stethoscope } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Mode = 'signin' | 'signup';

const MIN_PASSWORD_LENGTH = 8;

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;

    setError(null);
    setNotice(null);

    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setPending(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        const message = await signUp(email.trim(), password, fullName.trim());
        if (message) {
          setNotice(message);
          setMode('signin');
          setPassword('');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la operación.');
    } finally {
      setPending(false);
    }
  };

  const handleReset = async () => {
    if (!email.trim()) {
      setError('Escribí tu email para enviarte el enlace de recuperación.');
      return;
    }
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await resetPassword(email.trim());
      setNotice('Te enviamos un email para restablecer la contraseña.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el email.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="bg-primary/10 p-3 rounded-2xl text-primary">
            <Stethoscope className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MedScribe AI</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Notas clínicas estructuradas a partir de la consulta.
            </p>
          </div>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex bg-muted/50 p-1 rounded-lg border border-border/50">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className={cn(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  mode === 'signin' && 'bg-background shadow-sm text-foreground',
                )}
              >
                Iniciar sesión
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={cn(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  mode === 'signup' && 'bg-background shadow-sm text-foreground',
                )}
              >
                Crear cuenta
              </button>
            </div>
            <div>
              <CardTitle className="text-base">
                {mode === 'signin' ? 'Ingresá a tu cuenta' : 'Creá tu cuenta'}
              </CardTitle>
              <CardDescription className="mt-1">
                Tus consultas quedan guardadas de forma privada y solo vos podés verlas.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Nombre y apellido</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="name"
                    placeholder="Dra. Ana Pérez"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="tu@email.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'signup' ? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres` : ''}
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive leading-snug">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-primary leading-snug">
                  {notice}
                </p>
              )}

              <Button type="submit" className="w-full h-11" disabled={pending}>
                {pending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
              </Button>

              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={pending}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Olvidé mi contraseña
                </button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
