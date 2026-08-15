'use client';
import { Shell } from '../../components/shell';
import { ProtectedGate } from '../../components/route-gate';
export default function Profile() {
  return (
    <ProtectedGate>
      <Shell>
        <div className="page">
          <h1>Profile</h1>
          <div className="card">
            <p>Your profile settings are managed securely by your account.</p>
          </div>
        </div>
      </Shell>
    </ProtectedGate>
  );
}

