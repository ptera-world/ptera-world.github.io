import type { ConstraintSpec, ConstraintType } from "./types";

/** Constraint types by id. Registering an existing id replaces it (mods override built-ins this way). */
export class ConstraintRegistry {
  private types = new Map<string, ConstraintType<any>>();

  register<C extends ConstraintSpec>(t: ConstraintType<C>): void {
    this.types.set(t.type, t);
  }

  get(type: string): ConstraintType<ConstraintSpec> | undefined {
    return this.types.get(type);
  }

  list(): ConstraintType<ConstraintSpec>[] {
    return [...this.types.values()];
  }
}

export const constraintTypes = new ConstraintRegistry();
