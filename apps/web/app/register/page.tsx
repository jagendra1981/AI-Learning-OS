import { AuthForm } from '../../components/auth-form';
import { GuestGate } from '../../components/route-gate';
export default function Register() {
  return (
    <GuestGate>
      <div className="page">
        <h1>Create your account</h1>
        <p className="muted">Just the essentials to get started.</p>
        <AuthForm mode="register" />
      </div>
    </GuestGate>
  );
}
