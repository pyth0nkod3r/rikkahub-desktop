export interface SshHost {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  keyPath?: string;
  createdAt: number;
  updatedAt: number;
}
