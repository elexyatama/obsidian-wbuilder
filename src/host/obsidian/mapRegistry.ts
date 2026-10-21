import { TFile, type App } from "obsidian";
import { MAP_EXTENSION, parseMapData } from "../../core/mapFile";

/**
 * Which `.worldmap` file holds which map id. Notes refer to a map by id (`map: world`),
 * so the id lives inside the file and survives renames.
 */
export class MapRegistry {
	private readonly byId = new Map<string, TFile>();
	private readonly idOfPath = new Map<string, string>();

	constructor(private readonly app: App) {}

	static isMapFile(file: unknown): file is TFile {
		return file instanceof TFile && file.extension === MAP_EXTENSION;
	}

	async refresh(): Promise<void> {
		this.byId.clear();
		this.idOfPath.clear();
		const files = this.app.vault.getFiles().filter((f) => f.extension === MAP_EXTENSION);
		await Promise.all(files.map((f) => this.read(f)));
	}

	async read(file: TFile): Promise<void> {
		this.remove(file.path);
		try {
			const parsed = parseMapData(await this.app.vault.cachedRead(file));
			if (parsed.ok && !this.byId.has(parsed.data.id)) {
				this.byId.set(parsed.data.id, file);
				this.idOfPath.set(file.path, parsed.data.id);
			}
		} catch {
			// an unreadable map file simply isn't registered
		}
	}

	remove(path: string): void {
		const id = this.idOfPath.get(path);
		if (id !== undefined) this.byId.delete(id);
		this.idOfPath.delete(path);
	}

	fileFor(id: string): TFile | undefined {
		return this.byId.get(id);
	}

	/** The map opened by default: the first by path. */
	first(): TFile | undefined {
		return [...this.byId.values()].sort((a, b) => a.path.localeCompare(b.path))[0];
	}

	has(id: string): boolean {
		return this.byId.has(id);
	}
}
