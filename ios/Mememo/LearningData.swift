import Foundation

enum LearningData {
    static let packs: [LearningPack] = [
        LearningPack(
            id: "bookkeeping-2",
            label: "日商簿記2級",
            title: "日商簿記2級 商業簿記・工業簿記",
            description: "2026年度適用の出題区分を参照したオリジナル問題。",
            exam: "228問 / 四肢択一 / 解説あり",
            systemImage: "function"
        ),
        LearningPack(
            id: "bookkeeping-3",
            label: "日商簿記3級",
            title: "日商簿記3級 商業簿記",
            description: "2026年度適用の出題区分を参照したオリジナル問題。",
            exam: "126問 / 四肢択一 / 解説あり",
            systemImage: "sum"
        ),
        LearningPack(
            id: "itpass",
            label: "ITパスポート試験",
            title: "ITパスポート公式公開問題",
            description: "IPAが公開しているITパスポート試験の公式過去問題。",
            exam: "2,900問 / 四肢択一",
            systemImage: "bolt.badge.checkmark"
        ),
        LearningPack(
            id: "basic-info",
            label: "基本情報",
            title: "基本情報技術者試験 公開問題",
            description: "IPAが公開している基本情報技術者試験の最新公開問題。",
            exam: "78問 / 四肢択一",
            systemImage: "cpu"
        ),
        LearningPack(
            id: "applied-info",
            label: "応用情報",
            title: "応用情報技術者試験 午前公開問題",
            description: "IPAが公開している応用情報技術者試験の午前問題。",
            exam: "240問 / 四肢択一",
            systemImage: "server.rack"
        ),
        LearningPack(
            id: "officer-kyouyou",
            label: "幹部候補生 一般教養",
            title: "自衛隊幹部候補生等 一般教養",
            description: "防衛省・自衛隊が公開している一般教養問題。AI推定解答付きのみ出題。",
            exam: "五肢択一 / AI推定解答",
            systemImage: "shield.lefthalf.filled"
        ),
        LearningPack(
            id: "officer-senmon",
            label: "幹部候補生 専門択一",
            title: "自衛隊幹部候補生等 専門択一",
            description: "防衛省・自衛隊が公開している専門択一問題。AI推定解答付きのみ出題。",
            exam: "五肢択一 / AI推定解答",
            systemImage: "graduationcap"
        ),
    ]

    static let questions: [QuizQuestion] = loadQuestions()

    static func pack(for id: String) -> LearningPack? {
        packs.first { $0.id == id }
    }

    private static func loadQuestions() -> [QuizQuestion] {
        [
            "bookkeeping/level2",
            "bookkeeping/level3",
            "itpass",
            "basic-info",
            "applied-info",
            "officer/kyouyou",
            "officer/senmon",
        ].flatMap { subdirectory in
            guard let url = Bundle.main.url(forResource: "questions", withExtension: "json", subdirectory: subdirectory) else {
                assertionFailure("Missing \(subdirectory)/questions.json resource")
                return [QuizQuestion]()
            }
            do {
                let data = try Data(contentsOf: url)
                return try JSONDecoder().decode([QuizQuestion].self, from: data)
                    .filter { $0.isUsablePracticeQuestion }
            } catch {
                assertionFailure("Failed to decode \(subdirectory)/questions.json: \(error)")
                return []
            }
        }
    }
}
