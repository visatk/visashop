import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md text-center py-32 px-4">
      <p className="text-(--color-accent) font-bold">404</p>
      <h1 className="text-3xl font-bold mt-2">Page not found</h1>
      <p className="text-(--color-muted) mt-2">We couldn't find what you were looking for.</p>
      <Link to="/" className="btn-primary mt-6 inline-flex">Take me home</Link>
    </div>
  );
}
