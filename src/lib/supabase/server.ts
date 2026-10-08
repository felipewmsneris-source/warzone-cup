import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Cliente com a sessão do usuário: toda leitura passa pelo RLS do banco. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // chamado de um Server Component: o proxy renova a sessão
          }
        },
      },
    },
  );
}
