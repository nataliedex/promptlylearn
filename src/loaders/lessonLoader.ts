import fs from "fs";
import path from "path";
import { Lesson } from "../domain/lesson";

export function loadLesson(fileName: string): Lesson {
    const filePath = path.join(__dirname, "../data/lessons", fileName);
    const rawData = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(rawData) as Lesson;
}