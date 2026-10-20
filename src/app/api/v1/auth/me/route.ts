import { api } from "@/lib/api/handler";

export const GET = api({ partial: true }, async ({ actor }) => ({
  id: actor.id, email: actor.email, name: actor.name, businessUnit: actor.buName, roles: actor.roles, permissions: [...actor.permissions].sort(), mfa: actor.mfa,
}));
