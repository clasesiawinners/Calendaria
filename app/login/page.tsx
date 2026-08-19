import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="rounded-lg bg-white p-8 shadow-md text-center">
        <h1 className="mb-4 text-xl font-semibold">Calendario Operacional</h1>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/panel/calendario" });
          }}
        >
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Iniciar sesión con Google
          </button>
        </form>
      </div>
    </main>
  );
}
