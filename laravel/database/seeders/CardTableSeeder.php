<?php

namespace Database\Seeders;

use App\Models\Card;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class CardTableSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run()
    {
        $userId = 1;
        $totalCards = 10;

        for ($i = 1; $i <= $totalCards; $i++) {
            Card::create([
                'user_id' => $userId,
                'question' => 'question' . $i,
                'answer' => 'answer' . $i,
            ]);
        }
    }
}
