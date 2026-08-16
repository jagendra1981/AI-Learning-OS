import { AuthForm } from '../../components/auth-form';
import { GuestGate } from '../../components/route-gate';
export default function Login() {
  return (
    <GuestGate>
      <div className="page">
        <h1>Welcome back</h1>
        <p className="muted">Sign in to continue your learning workspace.</p>
        <AuthForm mode="login" />
      </div>
    </GuestGate>
  );
}
