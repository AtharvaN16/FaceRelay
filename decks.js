// Built-in decks. Each entry is an English Wikipedia page title.
// Photos + short descriptions are fetched live from Wikipedia at game start.
window.DECKS = {
  bollywood: {
    label: "Bollywood & Indian Cinema",
    emoji: "🎬",
    people: [
      "Shah Rukh Khan", "Amitabh Bachchan", "Salman Khan", "Aamir Khan", "Deepika Padukone",
      "Priyanka Chopra", "Alia Bhatt", "Ranbir Kapoor", "Ranveer Singh", "Katrina Kaif",
      "Hrithik Roshan", "Akshay Kumar", "Kareena Kapoor", "Aishwarya Rai Bachchan", "Madhuri Dixit",
      "Shahid Kapoor", "Varun Dhawan", "Vicky Kaushal", "Sonam Kapoor", "Anushka Sharma",
      "Ajay Devgn", "Kajol", "Nawazuddin Siddiqui", "Pankaj Tripathi", "Ayushmann Khurrana",
      "Rajkummar Rao", "Taapsee Pannu", "Sridevi", "Rekha", "Dharmendra",
      "Kartik Aaryan", "Shraddha Kapoor", "Tiger Shroff", "Sanjay Dutt",
      "Rajinikanth", "Kamal Haasan", "Vijay (actor)", "Prabhas", "Allu Arjun",
      "Mahesh Babu", "Ram Charan", "N. T. Rama Rao Jr.", "Dulquer Salmaan", "Dhanush",
      "Suriya", "Chiranjeevi", "Mohanlal", "Mammootty", "Tamannaah Bhatia",
      "Samantha Ruth Prabhu", "Rashmika Mandanna"
    ]
  },
  hollywood: {
    label: "Hollywood",
    emoji: "🍿",
    people: [
      "Leonardo DiCaprio", "Tom Cruise", "Brad Pitt", "Angelina Jolie", "Scarlett Johansson",
      "Robert Downey Jr.", "Chris Hemsworth", "Dwayne Johnson", "Will Smith", "Keanu Reeves",
      "Margot Robbie", "Zendaya", "Tom Holland", "Meryl Streep", "Morgan Freeman",
      "Johnny Depp", "Jennifer Lawrence", "Emma Watson", "Ryan Reynolds", "Ryan Gosling",
      "Denzel Washington", "Cillian Murphy", "Timothée Chalamet", "Natalie Portman", "Anne Hathaway",
      "Samuel L. Jackson", "Tom Hanks", "Nicole Kidman", "Keira Knightley", "Hugh Jackman",
      "Pedro Pascal", "Florence Pugh", "Jackie Chan", "Sandra Bullock", "Matt Damon"
    ]
  },
  music: {
    label: "Music Stars",
    emoji: "🎤",
    people: [
      "Taylor Swift", "Beyoncé", "Ed Sheeran", "Rihanna", "Drake (musician)",
      "Justin Bieber", "Billie Eilish", "Ariana Grande", "Bruno Mars", "Lady Gaga",
      "The Weeknd", "Dua Lipa", "Shakira", "Eminem", "Michael Jackson",
      "Freddie Mercury", "Elvis Presley", "Madonna", "Adele", "Harry Styles",
      "Bad Bunny", "Arijit Singh", "A. R. Rahman", "Lata Mangeshkar", "Shreya Ghoshal",
      "Diljit Dosanjh", "Badshah (rapper)", "Yo Yo Honey Singh", "Kishore Kumar", "Jungkook",
      "Lisa (rapper)", "Snoop Dogg", "Kanye West", "Post Malone", "Olivia Rodrigo"
    ]
  },
  sports: {
    label: "Sports Stars",
    emoji: "⚽",
    people: [
      "Lionel Messi", "Cristiano Ronaldo", "Neymar", "Kylian Mbappé", "Erling Haaland",
      "Mohamed Salah", "Vinícius Júnior", "Jude Bellingham", "Kevin De Bruyne", "Robert Lewandowski",
      "Luka Modrić", "Harry Kane", "Lamine Yamal", "Zlatan Ibrahimović", "Ronaldinho",
      "Zinedine Zidane", "David Beckham", "Pelé", "Diego Maradona", "Wayne Rooney",
      "Andrés Iniesta", "Sunil Chhetri",
      "Lewis Hamilton", "Max Verstappen", "Charles Leclerc", "Lando Norris", "Fernando Alonso",
      "Sebastian Vettel", "Michael Schumacher", "Oscar Piastri",
      "Roger Federer", "Rafael Nadal", "Novak Djokovic", "Serena Williams", "Carlos Alcaraz",
      "Jannik Sinner", "Venus Williams", "Naomi Osaka", "Maria Sharapova", "Sania Mirza",
      "Michael Jordan", "LeBron James", "Stephen Curry", "Kobe Bryant", "Giannis Antetokounmpo",
      "Tom Brady", "Tiger Woods", "Rory McIlroy", "Muhammad Ali", "Mike Tyson",
      "Floyd Mayweather Jr.", "Conor McGregor", "Usain Bolt", "Eliud Kipchoge", "Simone Biles",
      "Michael Phelps", "Neeraj Chopra", "P. V. Sindhu", "Mary Kom", "Abhinav Bindra",
      "Saina Nehwal", "Manu Bhaker",
      "Sachin Tendulkar", "Virat Kohli", "MS Dhoni", "Rohit Sharma", "Jasprit Bumrah",
      "Hardik Pandya", "Ben Stokes", "Shane Warne", "Ricky Ponting"
    ]
  },
  tech: {
    label: "Tech & Business",
    emoji: "💼",
    people: [
      "Elon Musk", "Mark Zuckerberg", "Bill Gates", "Steve Jobs", "Jeff Bezos",
      "Sundar Pichai", "Satya Nadella", "Tim Cook", "Sam Altman", "Jensen Huang",
      "Warren Buffett", "Ratan Tata", "Mukesh Ambani", "Gautam Adani", "N. R. Narayana Murthy",
      "Larry Page", "Sergey Brin", "Jack Ma", "Oprah Winfrey", "Richard Branson",
      "Steve Wozniak", "Bernard Arnault", "Larry Ellison", "Sheryl Sandberg", "Anand Mahindra",
      "Nandan Nilekani", "Kiran Mazumdar-Shaw", "Indra Nooyi"
    ]
  },
  history: {
    label: "Scientists, Writers & History",
    emoji: "🏛️",
    people: [
      "Albert Einstein", "Isaac Newton", "Marie Curie", "Nikola Tesla", "Stephen Hawking",
      "Charles Darwin", "Galileo Galilei", "Leonardo da Vinci", "Srinivasa Ramanujan", "C. V. Raman",
      "Thomas Edison", "Alan Turing", "Pablo Picasso", "Frida Kahlo",
      "William Shakespeare", "Rabindranath Tagore", "Mark Twain", "Charles Dickens", "J. K. Rowling",
      "George Orwell", "Ernest Hemingway", "Maya Angelou",
      "Mahatma Gandhi", "Jawaharlal Nehru", "B. R. Ambedkar", "Indira Gandhi", "A. P. J. Abdul Kalam",
      "Bhagat Singh", "Subhas Chandra Bose", "Swami Vivekananda", "Mother Teresa", "Nelson Mandela",
      "Martin Luther King Jr.", "Abraham Lincoln", "Winston Churchill", "Napoleon", "Cleopatra",
      "Narendra Modi", "Barack Obama", "Elizabeth II", "14th Dalai Lama"
    ]
  }
};
