import Link from "next/link";
import { signOut } from "@/auth";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="flex items-center justify-between border-b bg-white px-6 py-4">
        <div className="flex gap-6">
          <Link href="/panel/calendario" className="font-medium hover:text-blue-600">
            Calendario
          </Link>
          <Link href="/panel/bitacora" className="font-medium hover:text-blue-600">
            Bitácora
          </Link>
          <Link href="/panel/config" className="font-medium hover:text-blue-600">
            Configuración
          </Link>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="text-sm text-gray-500 hover:text-gray-700">
            Cerrar sesión
          </button>
        </form>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  );
}
