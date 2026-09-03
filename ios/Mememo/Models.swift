import Foundation
import Observation

struct LearningPack: Identifiable, Hashable {
    let id: String
    let label: String
    let title: String
    let description: String
    let exam: String
    let systemImage: String
}

struct QuizQuestion: Identifiable, Hashable, Decodable {
    let id: String
    let packID: String
    let subject: String
    let category: String
    let difficulty: String
    let prompt: String
    let choices: [String]
    let choiceLabels: [String]
    let answerIndex: Int
    let explanation: String
    let source: String
    let sourceURL: String
    let examId: String?
    let examTitle: String?
    let imagePath: String
    let imagePaths: [String]
    let transcriptionText: String

    var isUsablePracticeQuestion: Bool {
        answerIndex >= 0 && !Self.containsUnavailableCopyrightText(transcriptionText)
    }

    enum CodingKeys: String, CodingKey {
        case id
        case packID
        case packId
        case subject
        case category
        case difficulty
        case prompt
        case choices
        case choiceLabels
        case answerIndex
        case answer
        case explanation
        case source
        case sourceURL
        case sourceUrl
        case examId
        case examTitle
        case imagePath
        case image
        case images
        case imageResource
        case transcriptionText
        case transcription
    }

    enum TranscriptionKeys: String, CodingKey {
        case rawText
        case text
        case markdown
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        packID = try container.decodeIfPresent(String.self, forKey: .packID)
            ?? container.decodeIfPresent(String.self, forKey: .packId)
            ?? ""
        subject = try container.decodeIfPresent(String.self, forKey: .subject) ?? ""
        category = try container.decodeIfPresent(String.self, forKey: .category) ?? ""
        difficulty = try container.decodeIfPresent(String.self, forKey: .difficulty) ?? ""
        prompt = try container.decodeIfPresent(String.self, forKey: .prompt) ?? ""
        choices = try container.decodeIfPresent([String].self, forKey: .choices) ?? []

        let defaultLabels = Self.defaultChoiceLabels(count: choices.count, packID: packID)
        choiceLabels = try container.decodeIfPresent([String].self, forKey: .choiceLabels) ?? defaultLabels
        answerIndex = try container.decodeIfPresent(Int.self, forKey: .answerIndex)
            ?? container.decodeIfPresent(Int.self, forKey: .answer)
            ?? -1
        explanation = try container.decodeIfPresent(String.self, forKey: .explanation) ?? ""
        source = try container.decodeIfPresent(String.self, forKey: .source) ?? ""
        sourceURL = try container.decodeIfPresent(String.self, forKey: .sourceURL)
            ?? container.decodeIfPresent(String.self, forKey: .sourceUrl)
            ?? ""
        examId = try container.decodeIfPresent(String.self, forKey: .examId)
        examTitle = try container.decodeIfPresent(String.self, forKey: .examTitle)

        let decodedImages = try container.decodeIfPresent([String].self, forKey: .images) ?? []
        let primaryImage = try container.decodeIfPresent(String.self, forKey: .imagePath)
            ?? container.decodeIfPresent(String.self, forKey: .imageResource)
            ?? container.decodeIfPresent(String.self, forKey: .image)
            ?? decodedImages.first
            ?? ""
        imagePath = Self.normalizedResourcePath(primaryImage)
        imagePaths = (decodedImages.isEmpty ? [primaryImage] : decodedImages)
            .map(Self.normalizedResourcePath)
            .filter { !$0.isEmpty }

        let legacyText = try container.decodeIfPresent(String.self, forKey: .transcriptionText)
        let transcription = try? container.nestedContainer(keyedBy: TranscriptionKeys.self, forKey: .transcription)
        let markdownText = try transcription?.decodeIfPresent(String.self, forKey: .markdown)
        let plainText = try transcription?.decodeIfPresent(String.self, forKey: .text)
        let rawText = try transcription?.decodeIfPresent(String.self, forKey: .rawText)
        let sourceText = legacyText
            ?? markdownText
            ?? plainText
            ?? rawText
            ?? ""
        transcriptionText = Self.displayText(from: sourceText, packID: packID, examId: examId, choiceLabels: choiceLabels)
    }

    init(
        id: String,
        packID: String,
        subject: String,
        category: String,
        difficulty: String,
        prompt: String,
        choices: [String],
        choiceLabels: [String],
        answerIndex: Int,
        explanation: String,
        source: String,
        sourceURL: String,
        examId: String?,
        examTitle: String?,
        imagePath: String,
        imagePaths: [String],
        transcriptionText: String
    ) {
        self.id = id
        self.packID = packID
        self.subject = subject
        self.category = category
        self.difficulty = difficulty
        self.prompt = prompt
        self.choices = choices
        self.choiceLabels = choiceLabels
        self.answerIndex = answerIndex
        self.explanation = explanation
        self.source = source
        self.sourceURL = sourceURL
        self.examId = examId
        self.examTitle = examTitle
        self.imagePath = imagePath
        self.imagePaths = imagePaths
        self.transcriptionText = transcriptionText
    }

    private static func defaultChoiceLabels(count: Int, packID: String) -> [String] {
        if packID.hasPrefix("officer-") {
            return (1...max(count, 5)).map(String.init)
        }
        let labels = ["ア", "イ", "ウ", "エ", "オ", "カ", "キ", "ク"]
        return Array(labels.prefix(max(count, 4)))
    }

    private static func normalizedResourcePath(_ path: String) -> String {
        path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private static func displayText(from text: String, packID: String, examId: String?, choiceLabels: [String]) -> String {
        var value = stripInlineMarkdown(text)
        value = removeChoiceText(value, choiceLabels: choiceLabels)
        if packID.hasPrefix("officer-") {
            value = removeOfficerQuestionNumber(value)
        } else if packID == "itpass", ["2026r08", "2025r07", "2024r06"].contains(examId ?? "") {
            value = removeLatestItpassQuestionNumber(value)
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func stripInlineMarkdown(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"(?m)^\s{0,3}#{1,6}\s*"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "__", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func removeChoiceText(_ text: String, choiceLabels: [String]) -> String {
        if let range = text.range(
            of: #"(?m)(^|\n)\s*選択肢\s*(?:[（(][^）)]*[）)])?\s*[:：]?"#,
            options: .regularExpression
        ) {
            return String(text[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let range = text.range(
            of: #"(?m)(^|\n)\s*\|?\s*(?:a|A|ア|Ａ)\s*\|\s*(?:b|B|イ|Ｂ)\s*\|\s*(?:c|C|ウ|Ｃ)\s*\|\s*(?:d|D|エ|Ｄ)\s*\|?"#,
            options: .regularExpression
        ) {
            return String(text[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let labels = choiceLabels.isEmpty ? ["ア", "イ", "ウ", "エ"] : choiceLabels
        let escaped = labels.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "|")
        let choiceLine = #"^\s*(?:[-*•]\s*)?(?:\(?\s*(?:"# + escaped + #")\s*\)?|(?:"# + escaped + #")[.)．])\s*[:：.]?\s+"#
        let choiceTableLine = #"^\s*\|\s*\(?\s*(?:"# + escaped + #")\s*\)?\s*\|"#
        let numberedMarkdownLine = #"^\s*(?:"# + escaped + #")[.)．]\s+"#
        let patterns = [choiceLine, choiceTableLine, numberedMarkdownLine]

        var kept: [String] = []
        for line in text.components(separatedBy: .newlines) {
            if patterns.contains(where: { line.range(of: $0, options: .regularExpression) != nil }) {
                break
            }
            kept.append(line)
        }
        return kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func removeLatestItpassQuestionNumber(_ text: String) -> String {
        text.replacingOccurrences(of: #"^\s*問\s*\d{1,3}\s*"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func removeOfficerQuestionNumber(_ text: String) -> String {
        text.replacingOccurrences(of: #"^\s*(?:No\.?|問)\s*\d{1,3}\s*[:：.]?\s*"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"^\s*\d{1,3}\s*(?:\r?\n|$)"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func containsUnavailableCopyrightText(_ text: String) -> Bool {
        text.range(of: #"著作権の関係[^。\n]*(掲載できません|掲載できない)"#, options: .regularExpression) != nil
    }
}

struct ExamOption: Identifiable, Hashable {
    let id: String
    let title: String
    let questionCount: Int
}

enum StudyMode: String, CaseIterable, Identifiable {
    case random = "ランダム"
    case mock = "ミニ試験"
    case weak = "弱点"
    case bookmarked = "保存済み"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .random: "brain.head.profile"
        case .mock: "timer"
        case .weak: "target"
        case .bookmarked: "bookmark"
        }
    }
}

struct AttemptRecord: Codable, Hashable {
    var total: Int = 0
    var correct: Int = 0
    var wrong: Int = 0
    var lastResult: String = ""
    var lastAt: Date = .now

    mutating func record(correct isCorrect: Bool) {
        total += 1
        correct += isCorrect ? 1 : 0
        wrong += isCorrect ? 0 : 1
        lastResult = isCorrect ? "correct" : "wrong"
        lastAt = .now
    }
}

struct StudySession: Identifiable, Codable, Hashable {
    let id: UUID
    let date: Date
    let mode: String
    let total: Int
    let correct: Int
}

struct ProgressSummary {
    let total: Int
    let correct: Int
    let rate: Int
    let mastered: Int
}

struct PackProgress {
    let questionCount: Int
    let total: Int
    let correct: Int
    let mastered: Int
    let rate: Int
}

private struct StoredProgress: Codable {
    var catalogVersion: Int?
    var enabledPackIDs: [String]
    var attempts: [String: AttemptRecord]
    var bookmarks: [String]
    var sessions: [StudySession]
}

@Observable
final class StudyStore {
    var enabledPackIDs: Set<String>
    var attempts: [String: AttemptRecord]
    var bookmarks: Set<String>
    var sessions: [StudySession]
    var mode: StudyMode = .random
    var questionCount: Int = 10
    var selectedExamID: String = "all"

    private let storageKey = "mememo-progress-v1-ios"
    private let packCatalogVersion = 2

    init() {
        let defaults = Set(LearningData.packs.map(\.id))
        guard
            let data = UserDefaults.standard.data(forKey: storageKey),
            let stored = try? JSONDecoder().decode(StoredProgress.self, from: data)
        else {
            enabledPackIDs = defaults
            attempts = [:]
            bookmarks = []
            sessions = []
            return
        }
        let storedPackIDs = stored.enabledPackIDs.isEmpty ? defaults : Set(stored.enabledPackIDs)
        enabledPackIDs = (stored.catalogVersion ?? 1) < packCatalogVersion
            ? storedPackIDs.union(["bookkeeping-2", "bookkeeping-3"])
            : storedPackIDs
        attempts = stored.attempts
        bookmarks = Set(stored.bookmarks)
        sessions = stored.sessions
    }

    var summary: ProgressSummary {
        let allAttempts = Array(attempts.values)
        let total = allAttempts.reduce(0) { $0 + $1.total }
        let correct = allAttempts.reduce(0) { $0 + $1.correct }
        let rate = total > 0 ? Int((Double(correct) / Double(total) * 100).rounded()) : 0
        let mastered = allAttempts.filter { $0.total >= 2 && Double($0.correct) / Double(max(1, $0.total)) >= 0.8 }.count
        return ProgressSummary(total: total, correct: correct, rate: rate, mastered: mastered)
    }

    func isPackEnabled(_ packID: String) -> Bool {
        enabledPackIDs.contains(packID)
    }

    func togglePack(_ packID: String) {
        if enabledPackIDs.contains(packID), enabledPackIDs.count > 1 {
            enabledPackIDs.remove(packID)
        } else {
            enabledPackIDs.insert(packID)
        }
        selectedExamID = "all"
        save()
    }

    func toggleBookmark(_ questionID: String) {
        if bookmarks.contains(questionID) {
            bookmarks.remove(questionID)
        } else {
            bookmarks.insert(questionID)
        }
        save()
    }

    func record(_ question: QuizQuestion, isCorrect: Bool) {
        var current = attempts[question.id] ?? AttemptRecord()
        current.record(correct: isCorrect)
        attempts[question.id] = current
        save()
    }

    func finishSession(correct: Int, total: Int) {
        let session = StudySession(id: UUID(), date: .now, mode: mode.rawValue, total: total, correct: correct)
        sessions.insert(session, at: 0)
        sessions = Array(sessions.prefix(20))
        save()
    }

    func resetProgress() {
        attempts = [:]
        bookmarks = []
        sessions = []
        save()
    }

    func progress(for pack: LearningPack) -> PackProgress {
        let questions = LearningData.questions.filter { $0.packID == pack.id }
        let packAttempts = questions.compactMap { attempts[$0.id] }
        let total = packAttempts.reduce(0) { $0 + $1.total }
        let correct = packAttempts.reduce(0) { $0 + $1.correct }
        let rate = total > 0 ? Int((Double(correct) / Double(total) * 100).rounded()) : 0
        let mastered = packAttempts.filter { $0.total >= 2 && Double($0.correct) / Double(max(1, $0.total)) >= 0.8 }.count
        return PackProgress(questionCount: questions.count, total: total, correct: correct, mastered: mastered, rate: rate)
    }

    func buildQuiz() -> [QuizQuestion] {
        var source = LearningData.questions.filter { enabledPackIDs.contains($0.packID) }
        if selectedExamID != "all" {
            source = source.filter { $0.examId == selectedExamID }
        }

        switch mode {
        case .bookmarked:
            source = source.filter { bookmarks.contains($0.id) }
        case .weak:
            source = source.filter { question in
                guard let attempt = attempts[question.id] else { return false }
                let accuracy = Double(attempt.correct) / Double(max(1, attempt.total))
                return bookmarks.contains(question.id) || attempt.wrong > 0 || accuracy < 0.7
            }
        case .random, .mock:
            break
        }

        if source.isEmpty {
            return []
        }

        if mode == .weak {
            source.sort { left, right in
                let leftAttempt = attempts[left.id] ?? AttemptRecord()
                let rightAttempt = attempts[right.id] ?? AttemptRecord()
                return leftAttempt.wrong == rightAttempt.wrong
                    ? leftAttempt.correct < rightAttempt.correct
                    : leftAttempt.wrong > rightAttempt.wrong
            }
            return Array(source.prefix(questionCount))
        }

        return Array(source.shuffled().prefix(questionCount))
    }

    var examOptions: [ExamOption] {
        let scoped = LearningData.questions.filter { enabledPackIDs.contains($0.packID) }
        var options: [ExamOption] = []
        var counts: [String: Int] = [:]
        var titles: [String: String] = [:]
        for question in scoped {
            guard let examId = question.examId, let examTitle = question.examTitle else { continue }
            if counts[examId] == nil {
                options.append(ExamOption(id: examId, title: examTitle, questionCount: 0))
            }
            counts[examId, default: 0] += 1
            titles[examId] = examTitle
        }
        let fullOption = ExamOption(id: "all", title: "すべての試験回", questionCount: scoped.count)
        return [fullOption] + options.map {
            ExamOption(id: $0.id, title: titles[$0.id] ?? $0.title, questionCount: counts[$0.id] ?? 0)
        }
    }

    private func save() {
        let stored = StoredProgress(
            catalogVersion: packCatalogVersion,
            enabledPackIDs: Array(enabledPackIDs),
            attempts: attempts,
            bookmarks: Array(bookmarks),
            sessions: sessions
        )
        guard let data = try? JSONEncoder().encode(stored) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }
}
