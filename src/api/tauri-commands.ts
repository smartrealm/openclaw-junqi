import { invoke } from "@tauri-apps/api/core";

export interface NodeStatus { available: boolean; version: string | null; path: string | null; source: string | null; }
export interface GitStatus { available: boolean; version: string | null; path: string | null; source: string | null; }
export interface OpenclawStatus { installed: boolean; version: string | null; path: string | null; }
export interface DockerStatus { available: boolean; version: string | null; daemon_running: boolean; }

export const checkNode = () => invoke<NodeStatus>("check_node");
export const checkGit = () => invoke<GitStatus>("check_git");
export const checkOpenclaw = () => invoke<OpenclawStatus>("check_openclaw");
export const installNode = () => invoke<string>("install_node");
export const installGit = () => invoke<string>("install_git");
export const installOpenclaw = () => invoke<string>("install_openclaw");
export const startGateway = (port?: number) => invoke<any>("start_gateway", { port });
export const checkDocker = () => invoke<DockerStatus>("check_docker");
export const pullOpenclawImage = (tag?: string) => invoke<string>("pull_openclaw_image", { tag });
export const startDockerGateway = (port?: number, tag?: string) => invoke<any>("start_docker_gateway", { port, tag });
