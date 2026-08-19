export type ActivityStatus = "ejecutada" | "programada" | "pendiente" | "externa";

const STATUS_COLOR_MAP: Record<ActivityStatus, string> = {
  ejecutada: "verde",
  programada: "azul",
  pendiente: "naranjo",
  externa: "plomo",
};

export function colorForStatus(status: ActivityStatus): string {
  return STATUS_COLOR_MAP[status];
}
